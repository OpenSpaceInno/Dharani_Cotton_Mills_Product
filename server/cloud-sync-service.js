import './config/env.js';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool as defaultSourcePool } from './db.js';
import {
  SYNC_ELIGIBLE_TABLES,
  SYNC_EXCLUDED_TABLES,
  getSyncTableConfig,
  sanitizeRowForSync,
  buildConflictSafeUpsertSql,
} from './config/sync-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.env.DHARANI_DATA_DIR || path.resolve(__dirname, '..');
const logsDir = path.join(projectRoot, 'logs');
const logFile = path.join(logsDir, 'cloud-sync.log');

/**
 * Formats incoming row field values safely for MySQL parameterized queries
 * without shifting wall-clock DATETIME strings across timezones.
 */
export function sanitizeValueForMysql(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object') {
    if (val instanceof Date) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${val.getUTCFullYear()}-${pad(val.getUTCMonth() + 1)}-${pad(val.getUTCDate())} ${pad(val.getUTCHours())}:${pad(val.getUTCMinutes())}:${pad(val.getUTCSeconds())}`;
    }
    return JSON.stringify(val);
  }
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/i.test(val)) {
      return val.replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, '');
    }
    return val;
  }
  if (typeof val === 'boolean') {
    return val ? 1 : 0;
  }
  return val;
}

function toMysqlDateTimeString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * CloudSyncService
 * ============================================================================
 * Silent background incremental synchronization engine:
 *   LOCAL MYSQL -> SYNC ENGINE -> SERVER MYSQL
 *
 * Key Guarantees:
 * - Zero visible console/script popups; runs purely in-process or as a Docker worker.
 * - Single-instance execution lock via in-memory guard + MySQL GET_LOCK().
 * - Explicit table & column allowlist (sensitive passwords/secrets excluded).
 * - Topological parent-first ordering for foreign key integrity.
 * - Paginated cursor watermarks (watermark, pk) so no rows are skipped or repeated.
 * - Conflict-safe UPSERT (never overwrites newer destination records).
 * - Safe delete propagation via `sync_tombstones`.
 * - Persistent audit/monitoring log in `sync_logs` (no credentials stored or logged).
 * ============================================================================
 */
export class CloudSyncService {
  constructor(options = {}) {
    this.sourceHost = options.sourceHost || process.env.SOURCE_DB_HOST || process.env.DB_HOST || 'localhost';
    this.sourcePort = Number(options.sourcePort || process.env.SOURCE_DB_PORT || process.env.DB_PORT) || 3306;
    this.sourceUser = options.sourceUser || process.env.SOURCE_DB_USER || process.env.DB_USER || 'root';
    this.sourcePassword = options.sourcePassword ?? process.env.SOURCE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '';
    this.sourceDatabase = options.sourceDatabase || process.env.SOURCE_DB_NAME || process.env.DB_NAME || 'dharani_weighbridge';

    this.remoteHost = options.remoteHost || process.env.REMOTE_DB_HOST || '';
    this.remotePort = Number(options.remotePort || process.env.REMOTE_DB_PORT) || 3306;
    this.remoteUser = options.remoteUser || process.env.REMOTE_DB_USER || '';
    this.remotePassword = options.remotePassword ?? process.env.REMOTE_DB_PASSWORD ?? '';
    this.remoteDatabase = options.remoteDatabase || process.env.REMOTE_DB_NAME || 'dharani_weighbridge';

    this.cloudServerUrl = (options.cloudServerUrl ?? process.env.CLOUD_SERVER_URL ?? '').trim().replace(/\/+$/, '');
    this.cloudSyncSecret = String(options.cloudSyncSecret ?? process.env.CLOUD_SYNC_SECRET ?? '').trim().replace(/^['"]|['"]$/g, '');
    this.plantId = process.env.PLANT_ID || 'PL01';
    this.intervalMs = Math.max(5000, Number(process.env.CLOUD_SYNC_INTERVAL_MS) || 300000);
    this.syncBatchSize = Math.max(10, Math.min(1000, Number(process.env.CLOUD_SYNC_BATCH_SIZE) || 200));
    this.isEnabled = process.env.CLOUD_SYNC_ENABLED !== 'false';
    this.deletePropagationEnabled = process.env.SYNC_DELETE_PROPAGATION !== 'false';

    // Use custom source pool when SOURCE_DB_* differs from app DB_*; otherwise reuse app pool
    const usesDefaultPool =
      !options.sourceHost &&
      !process.env.SOURCE_DB_HOST &&
      !process.env.SOURCE_DB_NAME;

    this.sourcePool = usesDefaultPool
      ? defaultSourcePool
      : mysql.createPool({
          host: this.sourceHost,
          port: this.sourcePort,
          user: this.sourceUser,
          password: this.sourcePassword,
          database: this.sourceDatabase,
          waitForConnections: true,
          connectionLimit: Number(process.env.SOURCE_DB_POOL_SIZE) || 5,
          queueLimit: 0,
          connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
        });

    this.remoteDbPool = null;
    this.isRunning = false;
    this.timer = null;
    this.startupTimer = null;
    this.isSyncing = false;

    this.lastSyncReport = {
      lastSyncId: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextScheduledAt: null,
      status: 'idle',
      channel: 'none',
      totalChecked: 0,
      totalInserted: 0,
      totalUpdated: 0,
      totalDeleted: 0,
      totalUnchanged: 0,
      totalFailed: 0,
      recentErrors: [],
    };
  }

  getSourceLabel() {
    return `${this.sourceHost}:${this.sourcePort}/${this.sourceDatabase}`;
  }

  getDestinationLabel() {
    if (this.remoteHost && this.remoteDatabase) {
      return `${this.remoteHost}:${this.remotePort}/${this.remoteDatabase}`;
    }
    if (this.cloudServerUrl) {
      return this.cloudServerUrl;
    }
    return 'unconfigured';
  }

  isSelfTarget() {
    if (!this.remoteHost) return false;
    const norm = (h) => (h === '127.0.0.1' ? 'localhost' : String(h).toLowerCase());
    return (
      norm(this.sourceHost) === norm(this.remoteHost) &&
      Number(this.sourcePort) === Number(this.remotePort) &&
      this.sourceDatabase === this.remoteDatabase
    );
  }

  hasValidTarget() {
    if (this.isSelfTarget()) return false;
    const hasDirect = Boolean(this.remoteHost && this.remoteUser && this.remoteDatabase);
    const hasHttp = Boolean(this.cloudServerUrl && this.cloudSyncSecret);
    return hasDirect || hasHttp;
  }

  log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    console.log(line);

    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > 10 * 1024 * 1024) {
          const oldFile = `${logFile}.1`;
          try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {}
          try { fs.renameSync(logFile, oldFile); } catch {}
        }
      }
      fs.appendFileSync(logFile, line + '\n', 'utf8');
    } catch {}
  }

  async ensureMetadataTables() {
    await this.sourcePool.query(`
      CREATE TABLE IF NOT EXISTS edge_sync_tracking (
        table_name VARCHAR(64) PRIMARY KEY,
        last_synced_at DATETIME NOT NULL DEFAULT '2000-01-01 00:00:00',
        last_synced_pk VARCHAR(128) NOT NULL DEFAULT '',
        total_synced INT NOT NULL DEFAULT 0,
        pending_count INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'idle',
        last_error TEXT,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [cols] = await this.sourcePool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edge_sync_tracking'`
    );
    const colSet = new Set(cols.map((c) => c.COLUMN_NAME.toLowerCase()));
    if (!colSet.has('last_synced_pk')) {
      await this.sourcePool.query(
        `ALTER TABLE edge_sync_tracking ADD COLUMN last_synced_pk VARCHAR(128) NOT NULL DEFAULT '' AFTER last_synced_at`
      );
    }

    await this.sourcePool.query(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        sync_id VARCHAR(64) PRIMARY KEY,
        started_at DATETIME NOT NULL,
        completed_at DATETIME NULL,
        source_db VARCHAR(128) NOT NULL,
        destination_db VARCHAR(128) NOT NULL,
        channel VARCHAR(32) NOT NULL DEFAULT 'none',
        total_checked INT NOT NULL DEFAULT 0,
        inserted_count INT NOT NULL DEFAULT 0,
        updated_count INT NOT NULL DEFAULT 0,
        deleted_count INT NOT NULL DEFAULT 0,
        unchanged_count INT NOT NULL DEFAULT 0,
        failed_count INT NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'running',
        error_details TEXT NULL,
        table_summary JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sync_logs_started (started_at),
        INDEX idx_sync_logs_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.sourcePool.query(`
      CREATE TABLE IF NOT EXISTS sync_tombstones (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        table_name VARCHAR(64) NOT NULL,
        pk_column VARCHAR(64) NOT NULL,
        pk_value VARCHAR(128) NOT NULL,
        deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME NULL,
        sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        error_message TEXT NULL,
        INDEX idx_tombstone_pending (sync_status, deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  initRemotePool() {
    if (this.remoteDbPool) return;
    if (!this.remoteHost || !this.remoteUser || !this.remoteDatabase || this.isSelfTarget()) {
      return;
    }

    this.remoteDbPool = mysql.createPool({
      host: this.remoteHost,
      port: this.remotePort,
      user: this.remoteUser,
      password: this.remotePassword,
      database: this.remoteDatabase,
      waitForConnections: true,
      connectionLimit: Number(process.env.REMOTE_DB_POOL_SIZE) || 4,
      queueLimit: 0,
      connectTimeout: Number(process.env.REMOTE_DB_CONNECT_TIMEOUT_MS) || 8000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
    this.log(`📡 Direct Remote MySQL pool initialized -> ${this.getDestinationLabel()}`);
  }

  async initialize(options = {}) {
    const startScheduler = options.startScheduler ?? (process.env.SYNC_RUN_SCHEDULER !== 'false');

    try {
      await this.ensureMetadataTables();
      await this.hydrateLastStatusFromDb();
      this.initRemotePool();

      if (!this.isEnabled) {
        this.log('ℹ️ CloudSync disabled (CLOUD_SYNC_ENABLED=false).');
        return;
      }

      if (!this.hasValidTarget()) {
        this.log('ℹ️ CloudSync target not configured or matches source DB. Scheduler idle.');
        return;
      }

      this.log(
        `🔄 CloudSync engine initialized [Source: ${this.getSourceLabel()} -> Target: ${this.getDestinationLabel()}, Interval: ${Math.round(this.intervalMs / 1000)}s]`
      );

      if (startScheduler) {
        this.startSyncLoop();
      } else {
        this.log('ℹ️ In-process scheduler skipped (handled by dedicated sync-worker service).');
      }
    } catch (err) {
      this.log(`❌ CloudSync initialization error: ${err.message}`);
    }
  }

  async hydrateLastStatusFromDb() {
    try {
      const [rows] = await this.sourcePool.query(
        `SELECT sync_id, started_at, completed_at, channel, total_checked,
                inserted_count, updated_count, deleted_count, unchanged_count,
                failed_count, status, error_details
         FROM sync_logs
         ORDER BY started_at DESC
         LIMIT 20`
      );
      if (rows.length > 0) {
        const latest = rows[0];
        const lastSuccess = rows.find((r) => r.status === 'success' || r.status === 'clean_no_changes');
        this.lastSyncReport.lastSyncId = latest.sync_id;
        this.lastSyncReport.lastAttemptAt = latest.started_at ? new Date(latest.started_at).toISOString() : null;
        this.lastSyncReport.lastSuccessAt = lastSuccess?.completed_at
          ? new Date(lastSuccess.completed_at).toISOString()
          : null;
        this.lastSyncReport.status = latest.status;
        this.lastSyncReport.channel = latest.channel;
      }
    } catch {}
  }

  startSyncLoop() {
    if (this.isRunning) return;
    this.isRunning = true;

    const firstDelayMs = 3000;
    this.lastSyncReport.nextScheduledAt = new Date(Date.now() + firstDelayMs).toISOString();

    this.startupTimer = setTimeout(() => {
      this.runSyncCycle().catch((e) => this.log(`Initial sync cycle note: ${e.message}`));
    }, firstDelayMs);

    this.timer = setInterval(() => {
      this.runSyncCycle().catch((e) => this.log(`Interval sync cycle note: ${e.message}`));
    }, this.intervalMs);
  }

  stopSyncLoop() {
    this.isRunning = false;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async closePools() {
    this.stopSyncLoop();
    if (this.remoteDbPool) {
      await this.remoteDbPool.end().catch(() => {});
      this.remoteDbPool = null;
    }
    if (this.sourcePool !== defaultSourcePool) {
      await this.sourcePool.end().catch(() => {});
    }
  }

  async getExistingEligibleTables() {
    const [rows] = await this.sourcePool.query('SHOW TABLES');
    const existing = new Set(rows.map((r) => Object.values(r)[0].toLowerCase()));
    return SYNC_ELIGIBLE_TABLES.filter((cfg) => existing.has(cfg.table.toLowerCase()));
  }

  /**
   * Acquires a non-blocking MySQL advisory lock so overlapping sync executions
   * (across backend API trigger, scheduler, or sync-worker) cannot run concurrently.
   */
  async acquireSyncLock() {
    const conn = await this.sourcePool.getConnection();
    try {
      const [rows] = await conn.query("SELECT GET_LOCK('dharani_db_sync_lock', 0) AS acquired");
      if (rows[0]?.acquired === 1) {
        return conn;
      }
      conn.release();
      return null;
    } catch (err) {
      conn.release();
      throw err;
    }
  }

  async releaseSyncLock(lockConn) {
    if (!lockConn) return;
    try {
      await lockConn.query("SELECT RELEASE_LOCK('dharani_db_sync_lock')");
    } catch {}
    lockConn.release();
  }

  async insertSyncLogStart(syncId, startedAt) {
    try {
      await this.sourcePool.query(
        `INSERT INTO sync_logs (sync_id, started_at, source_db, destination_db, status)
         VALUES (?, ?, ?, ?, 'running')`,
        [syncId, toMysqlDateTimeString(startedAt), this.getSourceLabel(), this.getDestinationLabel()]
      );
    } catch (err) {
      this.log(`⚠️ Failed to insert sync_logs start record: ${err.message}`);
    }
  }

  async finalizeSyncLog(syncId, report) {
    try {
      await this.sourcePool.query(
        `UPDATE sync_logs
         SET completed_at = ?,
             channel = ?,
             total_checked = ?,
             inserted_count = ?,
             updated_count = ?,
             deleted_count = ?,
             unchanged_count = ?,
             failed_count = ?,
             status = ?,
             error_details = ?,
             table_summary = ?
         WHERE sync_id = ?`,
        [
          toMysqlDateTimeString(new Date()),
          report.channel || 'none',
          report.totalChecked || 0,
          report.totalInserted || 0,
          report.totalUpdated || 0,
          report.totalDeleted || 0,
          report.totalUnchanged || 0,
          report.totalFailed || 0,
          report.status,
          report.errors.length > 0 ? report.errors.join(' | ').slice(0, 4000) : null,
          JSON.stringify(report.tableDetails || {}),
          syncId,
        ]
      );
    } catch (err) {
      this.log(`⚠️ Failed to finalize sync_logs record ${syncId}: ${err.message}`);
    }
  }

  async pushToDestination(payloadTables, pendingDeletes = []) {
    let pushResult = null;

    if (this.remoteDbPool) {
      pushResult = await this.pushDirectDbSync(payloadTables, pendingDeletes);
      if (pushResult && pushResult.success) {
        return { ...pushResult, channel: 'direct_mysql' };
      }
    }

    if (this.cloudServerUrl && this.cloudSyncSecret) {
      if (this.remoteDbPool) {
        this.log('⚠️ Direct DB sync unavailable. Attempting secondary HTTP API push...');
      }
      pushResult = await this.pushHttpSync(payloadTables, pendingDeletes);
      if (pushResult && pushResult.success) {
        return { ...pushResult, channel: 'http_api' };
      }
    }

    return {
      success: false,
      channel: 'none',
      error: pushResult?.error || 'All destination sync channels unreachable',
    };
  }

  /**
   * Executes one complete incremental LOCAL -> SERVER synchronization cycle.
   */
  async runSyncCycle() {
    if (this.isSyncing) {
      this.log('⏳ Sync cycle already in progress locally. Skipping overlapping run.');
      return { skipped: true, reason: 'in_progress' };
    }

    if (!this.hasValidTarget()) {
      return { skipped: true, reason: 'target_unconfigured_or_self' };
    }

    await this.ensureMetadataTables();

    const lockConn = await this.acquireSyncLock();
    if (!lockConn) {
      this.log('⏳ Another sync worker holds dharani_db_sync_lock. Skipping overlapping run.');
      return { skipped: true, reason: 'locked_by_another_worker' };
    }

    this.isSyncing = true;
    const cycleStartTime = new Date();
    const syncId = `SYNC-${cycleStartTime.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    this.lastSyncReport.lastSyncId = syncId;
    this.lastSyncReport.lastAttemptAt = cycleStartTime.toISOString();
    this.lastSyncReport.status = 'running';
    if (this.isRunning) {
      this.lastSyncReport.nextScheduledAt = new Date(Date.now() + this.intervalMs).toISOString();
    }

    const report = {
      syncId,
      startTime: cycleStartTime.toISOString(),
      endTime: null,
      sourceDb: this.getSourceLabel(),
      destinationDb: this.getDestinationLabel(),
      status: 'running',
      channel: 'none',
      tablesProcessed: 0,
      totalChecked: 0,
      totalInserted: 0,
      totalUpdated: 0,
      totalDeleted: 0,
      totalUnchanged: 0,
      totalFailed: 0,
      errors: [],
      tableDetails: {},
    };

    await this.insertSyncLogStart(syncId, cycleStartTime);

    try {
      const activeTableConfigs = await this.getExistingEligibleTables();
      const syncedTableNames = new Set();

      // 1. Incremental per-table paginated synchronization (in strict FK order)
      for (const tableCfg of activeTableConfigs) {
        const table = tableCfg.table;
        try {
          const [trackRows] = await lockConn.query({
            sql: 'SELECT last_synced_at, last_synced_pk FROM edge_sync_tracking WHERE table_name = ?',
            values: [table],
            dateStrings: true,
          });

          let lastSyncedAt = trackRows.length > 0 && trackRows[0].last_synced_at
            ? trackRows[0].last_synced_at
            : '2000-01-01 00:00:00';
          let lastSyncedPk = trackRows.length > 0 && trackRows[0].last_synced_pk
            ? String(trackRows[0].last_synced_pk)
            : '';

          const [colRows] = await lockConn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table]
          );
          const cols = new Set(colRows.map((c) => c.COLUMN_NAME.toLowerCase()));

          const watermarkCol = cols.has(tableCfg.watermarkColumn)
            ? tableCfg.watermarkColumn
            : cols.has('updated_at')
            ? 'updated_at'
            : cols.has('created_at')
            ? 'created_at'
            : cols.has('timestamp')
            ? 'timestamp'
            : null;

          const pkCol = cols.has(tableCfg.pkColumn.toLowerCase()) ? tableCfg.pkColumn : null;

          // Ensure manually inserted rows with NULL watermark timestamps are captured incrementally
          if (watermarkCol === 'updated_at') {
            await lockConn.query(
              `UPDATE \`${table}\` SET \`updated_at\` = NOW() WHERE \`updated_at\` IS NULL`
            ).catch(() => {});
          } else if (watermarkCol === 'created_at') {
            await lockConn.query(
              `UPDATE \`${table}\` SET \`created_at\` = NOW() WHERE \`created_at\` IS NULL`
            ).catch(() => {});
          }

          let hasMore = true;
          while (hasMore) {
            let query = '';
            let params = [];

            if (watermarkCol && pkCol) {
              query = `SELECT * FROM \`${table}\`
                       WHERE \`${watermarkCol}\` > ?
                          OR (\`${watermarkCol}\` = ? AND CAST(\`${pkCol}\` AS CHAR) > ?)
                       ORDER BY \`${watermarkCol}\` ASC, \`${pkCol}\` ASC
                       LIMIT ?`;
              params = [lastSyncedAt, lastSyncedAt, lastSyncedPk, this.syncBatchSize];
            } else if (watermarkCol) {
              query = `SELECT * FROM \`${table}\`
                       WHERE \`${watermarkCol}\` > ?
                       ORDER BY \`${watermarkCol}\` ASC
                       LIMIT ?`;
              params = [lastSyncedAt, this.syncBatchSize];
            } else if (trackRows.length === 0 || String(lastSyncedAt).startsWith('2000-01-01')) {
              query = `SELECT * FROM \`${table}\` LIMIT ?`;
              params = [this.syncBatchSize];
              hasMore = false;
            } else {
              break;
            }

            const [rows] = await lockConn.query({
              sql: query,
              values: params,
              dateStrings: true,
            });

            if (!rows || rows.length === 0) {
              hasMore = false;
              break;
            }

            report.totalChecked += rows.length;
            const sanitizedRows = rows.map((row) => sanitizeRowForSync(tableCfg, row));
            const pushResult = await this.pushToDestination({ [table]: sanitizedRows }, []);

            if (!pushResult.success) {
              report.totalFailed += rows.length;
              report.errors.push(`${table}: ${pushResult.error}`);
              await lockConn.query(
                `INSERT INTO edge_sync_tracking (table_name, last_synced_at, last_synced_pk, status, last_error)
                 VALUES (?, ?, ?, 'error', ?)
                 ON DUPLICATE KEY UPDATE status = 'error', last_error = VALUES(last_error), updated_at = NOW()`,
                [table, lastSyncedAt, lastSyncedPk, String(pushResult.error).slice(0, 1000)]
              );
              throw new Error(pushResult.error || `Destination push failed on table ${table}`);
            }

            report.channel = pushResult.channel;
            const lastRow = rows[rows.length - 1];
            const nextWatermark = watermarkCol ? lastRow[watermarkCol] : toMysqlDateTimeString(new Date());
            const nextPk = pkCol ? String(lastRow[pkCol] ?? '') : '';

            await lockConn.query(
              `INSERT INTO edge_sync_tracking (table_name, last_synced_at, last_synced_pk, total_synced, status, last_error)
               VALUES (?, ?, ?, ?, 'synced', NULL)
               ON DUPLICATE KEY UPDATE
                 last_synced_at = VALUES(last_synced_at),
                 last_synced_pk = VALUES(last_synced_pk),
                 total_synced = total_synced + VALUES(total_synced),
                 status = 'synced',
                 last_error = NULL,
                 updated_at = NOW()`,
              [table, nextWatermark, nextPk, rows.length]
            );

            lastSyncedAt = nextWatermark;
            lastSyncedPk = nextPk;

            const stats = pushResult.summary?.tableStats?.[table] || {
              inserted: rows.length,
              updated: 0,
              unchanged: 0,
            };

            if (!report.tableDetails[table]) {
              report.tableDetails[table] = { inserted: 0, updated: 0, unchanged: 0 };
            }
            report.tableDetails[table].inserted += stats.inserted || 0;
            report.tableDetails[table].updated += stats.updated || 0;
            report.tableDetails[table].unchanged += stats.unchanged || 0;

            report.totalInserted += stats.inserted || 0;
            report.totalUpdated += stats.updated || 0;
            report.totalUnchanged += stats.unchanged || 0;
            syncedTableNames.add(table);

            if (rows.length < this.syncBatchSize) {
              hasMore = false;
            }
          }
        } catch (tblErr) {
          if (!report.errors.some((e) => e.includes(tblErr.message))) {
            report.errors.push(`Table ${table} error: ${tblErr.message}`);
          }
          // Stop advancing remaining child tables if destination itself went offline
          if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|PROTOCOL_CONNECTION_LOST|Access denied|unreachable/i.test(tblErr.message)) {
            throw tblErr;
          }
        }
      }

      // 2. Safe Deletion Propagation via sync_tombstones
      if (this.deletePropagationEnabled) {
        const [pendingDeletes] = await lockConn.query({
          sql: `SELECT id, table_name, pk_column, pk_value
                FROM sync_tombstones
                WHERE sync_status = 'pending'
                ORDER BY id ASC
                LIMIT ?`,
          values: [this.syncBatchSize],
          dateStrings: true,
        });

        const eligibleDeletes = pendingDeletes.filter((d) => {
          const cfg = getSyncTableConfig(d.table_name);
          return Boolean(cfg && cfg.supportsDeleteSync);
        });

        if (eligibleDeletes.length > 0) {
          report.totalChecked += eligibleDeletes.length;
          const delResult = await this.pushToDestination({}, eligibleDeletes);
          if (delResult.success) {
            report.channel = delResult.channel;
            const deletedCount = delResult.summary?.deletedRecords ?? eligibleDeletes.length;
            report.totalDeleted += deletedCount;

            const ids = eligibleDeletes.map((d) => d.id);
            await lockConn.query(
              `UPDATE sync_tombstones
               SET sync_status = 'synced', synced_at = NOW(), error_message = NULL
               WHERE id IN (?)`,
              [ids]
            );
          } else {
            report.totalFailed += eligibleDeletes.length;
            report.errors.push(`Delete propagation error: ${delResult.error}`);
            throw new Error(delResult.error || 'Delete propagation failed');
          }
        }
      }

      report.tablesProcessed = syncedTableNames.size;
      const hadChanges = report.totalInserted > 0 || report.totalUpdated > 0 || report.totalDeleted > 0;
      const hadProcessed = report.totalChecked > 0;

      if (report.errors.length > 0 && !hadProcessed) {
        report.status = 'failed';
      } else if (report.errors.length > 0) {
        report.status = 'partial_error';
      } else if (hadChanges || hadProcessed) {
        report.status = 'success';
      } else {
        report.status = 'clean_no_changes';
      }

      const nowIso = new Date().toISOString();
      if (report.status === 'success' || report.status === 'clean_no_changes') {
        this.lastSyncReport.lastSuccessAt = nowIso;
        this.lastSyncReport.status = report.status === 'success' ? 'healthy' : 'idle';
      } else {
        this.lastSyncReport.status = report.status;
      }

      this.lastSyncReport.channel = report.channel;
      this.lastSyncReport.totalChecked = report.totalChecked;
      this.lastSyncReport.totalInserted += report.totalInserted;
      this.lastSyncReport.totalUpdated += report.totalUpdated;
      this.lastSyncReport.totalDeleted += report.totalDeleted;
      this.lastSyncReport.totalUnchanged += report.totalUnchanged;
      this.lastSyncReport.totalFailed += report.totalFailed;

      if (report.status === 'success') {
        this.log(
          `✅ Sync [${syncId}] Success (${report.channel}): checked=${report.totalChecked} | +${report.totalInserted} inserted, ~${report.totalUpdated} updated, -${report.totalDeleted} deleted, =${report.totalUnchanged} unchanged (${Array.from(syncedTableNames).join(', ')})`
        );
      } else if (report.status === 'clean_no_changes') {
        this.log(`✅ Sync [${syncId}] clean: Local database is fully in sync with server.`);
      } else {
        this.log(`⚠️ Sync [${syncId}] finished with status=${report.status}: ${report.errors.join('; ')}`);
      }
    } catch (cycleErr) {
      const isNetworkDown = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|PROTOCOL_CONNECTION_LOST|unreachable|connect/i.test(cycleErr.message);
      report.status = isNetworkDown ? 'offline_queued' : 'failed';
      if (!report.errors.includes(cycleErr.message)) {
        report.errors.push(cycleErr.message);
      }
      this.lastSyncReport.status = report.status;
      this.lastSyncReport.totalFailed += report.totalFailed;
      this.lastSyncReport.recentErrors = [cycleErr.message, ...this.lastSyncReport.recentErrors.slice(0, 4)];
      this.log(`❌ Sync [${syncId}] ${report.status}: ${cycleErr.message}. Pending watermarks preserved for safe retry.`);
    } finally {
      report.endTime = new Date().toISOString();
      await this.finalizeSyncLog(syncId, report);
      this.isSyncing = false;
      await this.releaseSyncLock(lockConn);
    }

    return report;
  }

  /**
   * Direct Remote MySQL transactional UPSERT + safe DELETE execution.
   */
  async pushDirectDbSync(payloadData = {}, pendingDeletes = []) {
    if (!this.remoteDbPool) return { success: false, error: 'Remote DB pool not configured' };

    let conn = null;
    const summary = {
      tableStats: {},
      insertedRecords: 0,
      updatedRecords: 0,
      unchangedRecords: 0,
      deletedRecords: 0,
    };

    try {
      conn = await this.remoteDbPool.getConnection();
      await conn.beginTransaction();
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');

      const [existingTableRows] = await conn.query('SHOW TABLES');
      const existingTableSet = new Set(existingTableRows.map((r) => Object.values(r)[0].toLowerCase()));

      for (const [table, rows] of Object.entries(payloadData)) {
        if (!rows || rows.length === 0) continue;
        const tableCfg = getSyncTableConfig(table);
        if (!tableCfg) continue;
        if (!existingTableSet.has(table.toLowerCase())) continue;

        const [colRows] = await conn.query(
          `SELECT COLUMN_NAME, COLUMN_KEY
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [table]
        );
        const validCols = new Set(colRows.map((c) => c.COLUMN_NAME));
        const pkCols = colRows.filter((c) => c.COLUMN_KEY === 'PRI').map((c) => c.COLUMN_NAME);

        const sampleCols = Object.keys(rows[0]).filter((c) => validCols.has(c));
        if (sampleCols.length === 0) continue;

        let ins = 0;
        let upd = 0;
        let unc = 0;

        // Special duplicate-safe handling for append-only anpr_evidence without natural unique index
        if (table.toLowerCase() === 'anpr_evidence' && Array.isArray(tableCfg.appendOnlyCheckCols)) {
          const checkCols = tableCfg.appendOnlyCheckCols.filter((c) => validCols.has(c));
          const colListSql = sampleCols.map((c) => `\`${c}\``).join(', ');
          const placeholders = sampleCols.map(() => '?').join(', ');
          const insertSql = `INSERT INTO \`${table}\` (${colListSql}) VALUES (${placeholders})`;

          for (const row of rows) {
            if (checkCols.length > 0) {
              const whereClause = checkCols.map((c) => `\`${c}\` = ?`).join(' AND ');
              const checkVals = checkCols.map((c) => sanitizeValueForMysql(row[c]));
              const [existing] = await conn.query(
                `SELECT id FROM \`${table}\` WHERE ${whereClause} LIMIT 1`,
                checkVals
              );
              if (existing.length > 0) {
                unc++;
                continue;
              }
            }
            const values = sampleCols.map((c) => sanitizeValueForMysql(row[c]));
            const [result] = await conn.query(insertSql, values);
            if (result.affectedRows >= 1) ins++;
          }
        } else {
          const sql = buildConflictSafeUpsertSql(table, sampleCols, pkCols, tableCfg);
          for (const row of rows) {
            const values = sampleCols.map((c) => sanitizeValueForMysql(row[c]));
            const [result] = await conn.query(sql, values);
            if (result.affectedRows === 1) ins++;
            else if (result.affectedRows === 2) upd++;
            else unc++;
          }
        }

        summary.tableStats[table] = { inserted: ins, updated: upd, unchanged: unc };
        summary.insertedRecords += ins;
        summary.updatedRecords += upd;
        summary.unchangedRecords += unc;
      }

      for (const del of pendingDeletes) {
        const cfg = getSyncTableConfig(del.table_name);
        if (!cfg || !cfg.supportsDeleteSync) continue;
        if (!existingTableSet.has(del.table_name.toLowerCase())) continue;

        const [colRows] = await conn.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [del.table_name, del.pk_column]
        );
        if (colRows.length === 0) continue;

        const [delRes] = await conn.query(
          `DELETE FROM \`${del.table_name}\` WHERE \`${del.pk_column}\` = ?`,
          [del.pk_value]
        );
        if (delRes.affectedRows > 0) {
          summary.deletedRecords += delRes.affectedRows;
        }
      }

      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      await conn.commit();
      return { success: true, summary };
    } catch (err) {
      if (conn) {
        try {
          await conn.query('SET FOREIGN_KEY_CHECKS = 1');
          await conn.rollback();
        } catch {}
      }
      this.log(`Direct DB sync error: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Secondary HTTP fallback push to central backend POST /api/sync/push
   */
  async pushHttpSync(payloadData = {}, pendingDeletes = []) {
    try {
      const endpoint = `${this.cloudServerUrl}/api/sync/push`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-secret': this.cloudSyncSecret,
          'x-plant-id': this.plantId,
        },
        body: JSON.stringify({
          plantId: this.plantId,
          timestamp: new Date().toISOString(),
          tables: payloadData,
          deletes: pendingDeletes,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }

      const json = await res.json().catch(() => ({ success: true }));
      return json;
    } catch (err) {
      this.log(`HTTP Sync push note (${err.message})`);
      return { success: false, error: err.message };
    }
  }

  async getLogs(limit = 25) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const [logs] = await this.sourcePool.query(
      `SELECT sync_id, started_at, completed_at, source_db, destination_db, channel,
              total_checked, inserted_count, updated_count, deleted_count, unchanged_count,
              failed_count, status, error_details, table_summary
       FROM sync_logs
       ORDER BY started_at DESC
       LIMIT ?`,
      [safeLimit]
    ).catch(() => [[]]);
    return logs;
  }

  async getStatus() {
    await this.ensureMetadataTables().catch(() => {});
    const [tracking] = await this.sourcePool.query(
      'SELECT table_name, last_synced_at, last_synced_pk, total_synced, pending_count, status, last_error, updated_at FROM edge_sync_tracking ORDER BY table_name ASC'
    ).catch(() => [[]]);
    const recentLogs = await this.getLogs(15);

    const [totalsRows] = await this.sourcePool.query(
      `SELECT
         COALESCE(SUM(inserted_count), 0) AS lifetime_inserted,
         COALESCE(SUM(updated_count), 0) AS lifetime_updated,
         COALESCE(SUM(deleted_count), 0) AS lifetime_deleted,
         COALESCE(SUM(failed_count), 0) AS lifetime_failed
       FROM sync_logs`
    ).catch(() => [[{ lifetime_inserted: 0, lifetime_updated: 0, lifetime_deleted: 0, lifetime_failed: 0 }]]);

    const latestLog = recentLogs[0] || null;
    const lastSuccessLog = recentLogs.find((r) => r.status === 'success' || r.status === 'clean_no_changes') || null;
    const lastAttemptIso = this.lastSyncReport.lastAttemptAt || (latestLog?.started_at ? new Date(latestLog.started_at).toISOString() : null);
    const lastSuccessIso = this.lastSyncReport.lastSuccessAt || (lastSuccessLog?.completed_at ? new Date(lastSuccessLog.completed_at).toISOString() : null);
    const nextScheduledIso = this.lastSyncReport.nextScheduledAt || (
      this.isEnabled && lastAttemptIso
        ? new Date(new Date(lastAttemptIso).getTime() + this.intervalMs).toISOString()
        : null
    );

    return {
      enabled: this.isEnabled,
      schedulerActive: this.isRunning,
      mode: this.remoteDbPool ? 'direct_mysql' : (this.cloudServerUrl ? 'http_api' : 'none'),
      sourceDatabase: this.getSourceLabel(),
      targetDatabase: this.getDestinationLabel(),
      plantId: this.plantId,
      intervalMs: this.intervalMs,
      intervalMinutes: Math.round(this.intervalMs / 60000),
      isCurrentlySyncing: this.isSyncing,
      lastSyncId: this.lastSyncReport.lastSyncId || latestLog?.sync_id || null,
      lastAttemptAt: lastAttemptIso,
      lastSuccessAt: lastSuccessIso,
      nextScheduledAt: nextScheduledIso,
      status: this.lastSyncReport.status !== 'idle' ? this.lastSyncReport.status : (latestLog?.status || 'idle'),
      channel: this.lastSyncReport.channel !== 'none' ? this.lastSyncReport.channel : (latestLog?.channel || 'none'),
      lastCycle: latestLog
        ? {
            syncId: latestLog.sync_id,
            checked: latestLog.total_checked,
            inserted: latestLog.inserted_count,
            updated: latestLog.updated_count,
            deleted: latestLog.deleted_count,
            unchanged: latestLog.unchanged_count,
            failed: latestLog.failed_count,
            status: latestLog.status,
            errorDetails: latestLog.error_details,
          }
        : null,
      totals: {
        inserted: Number(totalsRows[0]?.lifetime_inserted || 0),
        updated: Number(totalsRows[0]?.lifetime_updated || 0),
        deleted: Number(totalsRows[0]?.lifetime_deleted || 0),
        failed: Number(totalsRows[0]?.lifetime_failed || 0),
      },
      recentErrors: this.lastSyncReport.recentErrors,
      tables: tracking,
      recentLogs,
      eligibleTables: SYNC_ELIGIBLE_TABLES.map((t) => ({
        table: t.table,
        stage: t.stage,
        pkColumn: t.pkColumn,
        watermarkColumn: t.watermarkColumn,
        excludedColumns: t.excludedColumns,
        supportsDeleteSync: t.supportsDeleteSync,
      })),
      excludedTables: SYNC_EXCLUDED_TABLES,
    };
  }
}

export const cloudSyncService = new CloudSyncService();
export default cloudSyncService;
