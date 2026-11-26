import express from 'express';
import { pool } from '../db.js';
import cloudSyncService, { sanitizeValueForMysql } from '../cloud-sync-service.js';
import {
  SYNC_ELIGIBLE_TABLES,
  SYNC_EXCLUDED_TABLES,
  getSyncTableConfig,
  sanitizeRowForSync,
  buildConflictSafeUpsertSql,
} from '../config/sync-config.js';

const router = express.Router();
const EXPECTED_SYNC_SECRET = process.env.CLOUD_SYNC_SECRET || '';

// ============================================================================
// GET /api/sync/status
// Reports sync worker status, schedule, totals, per-table watermarks, & logs
// (Never exposes passwords or sensitive connection secrets)
// ============================================================================
router.get('/status', async (req, res) => {
  try {
    const status = await cloudSyncService.getStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// GET /api/sync/logs
// Returns historical synchronization runs from sync_logs
// ============================================================================
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
    const logs = await cloudSyncService.getLogs(limit);
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// GET /api/sync/config
// Returns explicit table sync policy (eligible tables & excluded secrets)
// ============================================================================
router.get('/config', (req, res) => {
  res.json({
    success: true,
    direction: 'LOCAL_TO_SERVER',
    intervalMs: cloudSyncService.intervalMs,
    sourceDatabase: cloudSyncService.getSourceLabel(),
    targetDatabase: cloudSyncService.getDestinationLabel(),
    eligibleTables: SYNC_ELIGIBLE_TABLES,
    excludedTables: SYNC_EXCLUDED_TABLES,
  });
});

// ============================================================================
// POST /api/sync/trigger
// Optional manual trigger (uses MySQL advisory lock; safe against overlaps)
// ============================================================================
router.post('/trigger', async (req, res) => {
  try {
    const result = await cloudSyncService.runSyncCycle();
    res.json({ success: true, message: 'Sync cycle completed', report: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// POST /api/sync/init-tables
// Idempotently ensures core operational and sync monitoring tables exist
// ============================================================================
router.post('/init-tables', async (req, res) => {
  try {
    await cloudSyncService.ensureMetadataTables();
    res.json({ success: true, message: 'Sync tracking and monitoring tables initialized successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// POST /api/sync/push
// Central Server Receiver: Conflict-safe transactional upsert + delete sync
// ============================================================================
router.post('/push', async (req, res) => {
  const incomingSecret = req.headers['x-sync-secret'] || req.body?.syncSecret;
  if (!EXPECTED_SYNC_SECRET || incomingSecret !== EXPECTED_SYNC_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid x-sync-secret' });
  }

  const { plantId, tables = {}, deletes = [] } = req.body;
  if (typeof tables !== 'object' || tables === null) {
    return res.status(400).json({ success: false, error: 'Payload must contain a tables map' });
  }

  const connection = await pool.getConnection();
  const summary = {
    totalTables: 0,
    insertedRecords: 0,
    updatedRecords: 0,
    unchangedRecords: 0,
    deletedRecords: 0,
    tableStats: {},
  };

  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.beginTransaction();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    const [existingTableRows] = await connection.query('SHOW TABLES');
    const existingTableSet = new Set(existingTableRows.map((r) => Object.values(r)[0].toLowerCase()));

    for (const [tableName, rawRows] of Object.entries(tables)) {
      if (!Array.isArray(rawRows) || rawRows.length === 0) continue;
      const tableCfg = getSyncTableConfig(tableName);
      if (!tableCfg) {
        console.warn(`[Sync Receiver] Rejected ineligible/sensitive table '${tableName}'`);
        continue;
      }
      if (!existingTableSet.has(tableName.toLowerCase())) {
        console.warn(`[Sync Receiver] Skipped missing table '${tableName}'`);
        continue;
      }

      const [colRows] = await connection.query(
        `SELECT COLUMN_NAME, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
      );
      const validColSet = new Set(colRows.map((c) => c.COLUMN_NAME));
      const pkCols = colRows.filter((c) => c.COLUMN_KEY === 'PRI').map((c) => c.COLUMN_NAME);

      const sanitizedRows = rawRows.map((r) => sanitizeRowForSync(tableCfg, r));
      const validCols = Object.keys(sanitizedRows[0]).filter((c) => validColSet.has(c));
      if (validCols.length === 0) continue;

      let insertedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      if (tableName.toLowerCase() === 'anpr_evidence' && Array.isArray(tableCfg.appendOnlyCheckCols)) {
        const checkCols = tableCfg.appendOnlyCheckCols.filter((c) => validColSet.has(c));
        const colListSql = validCols.map((c) => `\`${c}\``).join(', ');
        const placeholders = validCols.map(() => '?').join(', ');
        const insertSql = `INSERT INTO \`${tableName}\` (${colListSql}) VALUES (${placeholders})`;

        for (const row of sanitizedRows) {
          if (checkCols.length > 0) {
            const whereClause = checkCols.map((c) => `\`${c}\` = ?`).join(' AND ');
            const checkVals = checkCols.map((c) => sanitizeValueForMysql(row[c]));
            const [existing] = await connection.query(
              `SELECT id FROM \`${tableName}\` WHERE ${whereClause} LIMIT 1`,
              checkVals
            );
            if (existing.length > 0) {
              unchangedCount++;
              continue;
            }
          }
          const values = validCols.map((col) => sanitizeValueForMysql(row[col]));
          const [result] = await connection.query(insertSql, values);
          if (result.affectedRows >= 1) insertedCount++;
        }
      } else {
        const sql = buildConflictSafeUpsertSql(tableName, validCols, pkCols, tableCfg);
        for (const row of sanitizedRows) {
          const values = validCols.map((col) => sanitizeValueForMysql(row[col]));
          const [result] = await connection.query(sql, values);
          if (result.affectedRows === 1) insertedCount++;
          else if (result.affectedRows === 2) updatedCount++;
          else unchangedCount++;
        }
      }

      summary.tableStats[tableName] = {
        total: sanitizedRows.length,
        inserted: insertedCount,
        updated: updatedCount,
        unchanged: unchangedCount,
      };
      summary.insertedRecords += insertedCount;
      summary.updatedRecords += updatedCount;
      summary.unchangedRecords += unchangedCount;
      summary.totalTables++;
    }

    if (Array.isArray(deletes)) {
      for (const del of deletes) {
        const cfg = getSyncTableConfig(del?.table_name);
        if (!cfg || !cfg.supportsDeleteSync) continue;
        if (!existingTableSet.has(del.table_name.toLowerCase())) continue;

        const [colRows] = await connection.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [del.table_name, del.pk_column]
        );
        if (colRows.length === 0) continue;

        const [delRes] = await connection.query(
          `DELETE FROM \`${del.table_name}\` WHERE \`${del.pk_column}\` = ?`,
          [del.pk_value]
        );
        if (delRes.affectedRows > 0) {
          summary.deletedRecords += delRes.affectedRows;
        }
      }
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.commit();

    console.log(
      `📥 [Sync Receiver] Plant [${plantId || 'remote'}]: +${summary.insertedRecords} inserted, ~${summary.updatedRecords} updated, -${summary.deletedRecords} deleted, =${summary.unchangedRecords} unchanged`
    );

    res.json({
      success: true,
      plantId,
      summary,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      await connection.rollback();
    } catch {}
    console.error('[Sync Receiver] Upsert error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

export default router;
