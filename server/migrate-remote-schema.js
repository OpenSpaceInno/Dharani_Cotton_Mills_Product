import './config/env.js';
import mysql from 'mysql2/promise';

async function migrateRemoteSchema() {
  console.log('=== Migrating Remote MySQL Schema (using environment configuration) ===');

  const remoteHost = process.env.REMOTE_DB_HOST;
  const remotePort = Number(process.env.REMOTE_DB_PORT) || 3306;
  const remoteUser = process.env.REMOTE_DB_USER;
  const remotePassword = process.env.REMOTE_DB_PASSWORD;
  const remoteDb = process.env.REMOTE_DB_NAME || 'dharani_weighbridge';

  if (!remoteHost || !remoteUser || !remotePassword) {
    throw new Error('REMOTE_DB_HOST, REMOTE_DB_USER, and REMOTE_DB_PASSWORD must be configured in environment.');
  }

  const localDb = process.env.DB_NAME || 'dharani_weighbridge';

  const remoteConn = await mysql.createConnection({
    host: remoteHost,
    port: remotePort,
    user: remoteUser,
    password: remotePassword,
    database: remoteDb,
    connectTimeout: Number(process.env.REMOTE_DB_CONNECT_TIMEOUT_MS) || 10000,
  });

  const localConn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: localDb,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000,
  });

  const requiredTables = [
    'anpr_events',
    'anpr_evidence',
    'anpr_config',
    'company_settings',
    'report_field_configs',
    'weighbridge_devices',
    'printer_devices',
    'edge_sync_tracking',
    'sync_logs',
    'sync_tombstones',
  ];

  for (const table of requiredTables) {
    const [remoteTables] = await remoteConn.query('SHOW TABLES LIKE ?', [table]);
    if (remoteTables.length === 0) {
      const [localTables] = await localConn.query('SHOW TABLES LIKE ?', [table]);
      if (localTables.length === 0) continue;

      console.log(`Table '${table}' missing on remote. Creating from local definition...`);
      const [createRes] = await localConn.query(`SHOW CREATE TABLE \`${table}\``);
      const createSql = createRes[0]['Create Table'];
      await remoteConn.query(createSql);
      console.log(`✅ Created table '${table}' on remote.`);
    } else {
      console.log(`Table '${table}' already exists on remote.`);
    }
  }

  const syncColumnsTables = ['weighbridge_sessions', 'weigh_slips', 'anpr_evidence'];
  for (const tbl of syncColumnsTables) {
    const [localCols] = await localConn.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [localDb, tbl]
    );
    const [remoteCols] = await remoteConn.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [remoteDb, tbl]
    );
    const remoteSet = new Set(remoteCols.map((c) => c.COLUMN_NAME.toLowerCase()));

    for (const col of localCols) {
      if (!remoteSet.has(col.COLUMN_NAME.toLowerCase())) {
        const nullClause = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
        const defClause = col.COLUMN_DEFAULT !== null && !String(col.COLUMN_DEFAULT).includes('CURRENT_TIMESTAMP')
          ? `DEFAULT ${mysql.escape(col.COLUMN_DEFAULT)}`
          : '';
        const alterSql = `ALTER TABLE \`${tbl}\` ADD COLUMN \`${col.COLUMN_NAME}\` ${col.COLUMN_TYPE} ${nullClause} ${defClause}`.trim();
        try {
          await remoteConn.query(alterSql);
          console.log(`✅ Added ${tbl}.${col.COLUMN_NAME} on remote.`);
        } catch (err) {
          console.log(`⚠️ Column add note (${tbl}.${col.COLUMN_NAME}): ${err.message}`);
        }
      }
    }
  }

  console.log('=== Remote Schema Migration Finished ===');
  await localConn.end();
  await remoteConn.end();
}

migrateRemoteSchema().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
