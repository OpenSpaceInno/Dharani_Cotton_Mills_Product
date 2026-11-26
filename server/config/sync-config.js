/**
 * Explicit Synchronization Configuration & Data Integrity Policy
 * ============================================================================
 * Defines which tables are eligible for LOCAL -> SERVER incremental sync,
 * their topological dependency order, natural conflict keys, timestamp
 * watermarks, sensitive column exclusions, and deletion propagation rules.
 *
 * Security & Integrity Rules:
 * - Never blindly sync every table in the database.
 * - Never sync authentication secrets, passwords, or API keys.
 * - Always sync parent tables before child tables (FK order).
 * - Never overwrite newer server-side records with older local records.
 */

export const SYNC_EXCLUDED_TABLES = [
  {
    table: 'users',
    reason: 'Contains password_hash credentials; manage user accounts per environment or enable explicitly without passwords.',
  },
  {
    table: 'device_ftp_config',
    reason: 'Contains plaintext FTP, camera, and admin passwords.',
  },
  {
    table: 'ftp_configs',
    reason: 'Contains plaintext FTP credentials.',
  },
  {
    table: 'sap_connection_config',
    reason: 'Contains environment-specific SAP host and masked credential config.',
  },
  {
    table: 'edge_sync_tracking',
    reason: 'Local synchronization watermark metadata.',
  },
  {
    table: 'sync_logs',
    reason: 'Local synchronization execution history.',
  },
  {
    table: 'sync_tombstones',
    reason: 'Local deletion propagation queue.',
  },
];

/**
 * Ordered list of tables eligible for LOCAL -> SERVER synchronization.
 * Order is strictly topological (parents before children).
 */
export const SYNC_ELIGIBLE_TABLES = [
  // Stage 1: Master settings, roles, plants, and hardware registries
  {
    table: 'roles',
    stage: 1,
    pkColumn: 'id',
    conflictKeys: ['id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: true,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'plants',
    stage: 1,
    pkColumn: 'id',
    conflictKeys: ['id', 'code'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'company_settings',
    stage: 1,
    pkColumn: 'id',
    conflictKeys: ['id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'camera_devices',
    stage: 1,
    pkColumn: 'device_id',
    conflictKeys: ['device_id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: true, // Omit UUID `id` so natural key `device_id` matches cleanly
    excludedColumns: [],
    supportsDeleteSync: true,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'weighbridge_devices',
    stage: 1,
    pkColumn: 'id',
    conflictKeys: ['id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: true,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'printer_devices',
    stage: 1,
    pkColumn: 'id',
    conflictKeys: ['id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: true,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'report_field_configs',
    stage: 1,
    pkColumn: 'id',
    conflictKeys: ['user_id', 'report_type', 'field_key'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: true, // Natural unique key (user_id, report_type, field_key)
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: true,
  },

  // Stage 2: Child device configs (FK -> camera_devices.device_id)
  {
    table: 'device_network_config',
    stage: 2,
    pkColumn: 'device_id',
    conflictKeys: ['device_id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: true,
    excludedColumns: [],
    supportsDeleteSync: true,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'device_rtsp_config',
    stage: 2,
    pkColumn: 'device_id',
    conflictKeys: ['device_id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: true,
    excludedColumns: ['password'], // Never sync camera RTSP password
    supportsDeleteSync: true,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'anpr_config',
    stage: 2,
    pkColumn: 'camera_id',
    conflictKeys: ['camera_id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: true,
    excludedColumns: ['api_key'], // Never sync third-party ANPR API keys
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: true,
  },

  // Stage 3: Core operational weighbridge transactions
  {
    table: 'weighbridge_sessions',
    stage: 3,
    pkColumn: 'session_id',
    conflictKeys: ['session_id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'weigh_slips',
    stage: 3,
    pkColumn: 'slip_number',
    conflictKeys: ['slip_number'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: true,
  },

  // Stage 4: Gate ANPR detections & evidence (anpr_evidence FK -> anpr_events.event_id)
  {
    table: 'anpr_events',
    stage: 4,
    pkColumn: 'event_id',
    conflictKeys: ['event_id'],
    watermarkColumn: 'updated_at',
    omitSurrogateId: true, // Auto-increment id differs per DB; match on unique event_id
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: true,
  },
  {
    table: 'anpr_evidence',
    stage: 4,
    pkColumn: 'id',
    conflictKeys: ['event_id', 'angle', 'url'],
    watermarkColumn: 'created_at',
    omitSurrogateId: true,
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: false,
    appendOnlyCheckCols: ['event_id', 'angle', 'url'],
  },

  // Stage 5: Operational audit logs (append-only)
  {
    table: 'audit_logs',
    stage: 5,
    pkColumn: 'id',
    conflictKeys: ['id'],
    watermarkColumn: 'created_at',
    omitSurrogateId: false,
    excludedColumns: [],
    supportsDeleteSync: false,
    hasUpdatedAtConflictGuard: false,
  },
];

export const SYNC_TABLE_MAP = new Map(
  SYNC_ELIGIBLE_TABLES.map((cfg) => [cfg.table.toLowerCase(), cfg])
);

/**
 * Returns the sync configuration for a table (if eligible).
 */
export function getSyncTableConfig(tableName) {
  if (!tableName) return null;
  return SYNC_TABLE_MAP.get(String(tableName).toLowerCase()) || null;
}

/**
 * Strips excluded sensitive columns and surrogate auto-increment/UUID IDs
 * according to the table's sync policy.
 */
export function sanitizeRowForSync(tableConfig, row) {
  if (!row || typeof row !== 'object') return {};
  const excluded = new Set((tableConfig?.excludedColumns || []).map((c) => c.toLowerCase()));
  if (tableConfig?.omitSurrogateId) {
    excluded.add('id');
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(row)) {
    if (excluded.has(key.toLowerCase())) continue;
    if (tableConfig?.table === 'company_settings' && key === 'logo_url' && typeof value === 'string' && value.length > 60000) {
      sanitized[key] = '/logo.png';
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

/**
 * Builds a conflict-safe MySQL UPSERT statement that:
 * 1. Never updates primary or natural conflict keys.
 * 2. When `updated_at` is present, avoids overwriting newer destination records
 *    with older source records.
 */
export function buildConflictSafeUpsertSql(tableName, columns, pkColumns, tableConfig) {
  const colListSql = columns.map((c) => `\`${c}\``).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  const conflictSet = new Set([
    ...pkColumns.map((c) => c.toLowerCase()),
    ...((tableConfig?.conflictKeys || []).map((c) => c.toLowerCase())),
  ]);

  const updatableCols = columns
    .filter((c) => !conflictSet.has(c.toLowerCase()))
    .sort((a, b) => {
      // Ensure `updated_at` is always evaluated LAST in MySQL's left-to-right SET evaluation
      if (a.toLowerCase() === 'updated_at') return 1;
      if (b.toLowerCase() === 'updated_at') return -1;
      return 0;
    });
  const hasUpdatedAt = columns.some((c) => c.toLowerCase() === 'updated_at') && tableConfig?.hasUpdatedAtConflictGuard !== false;

  // Append-only tables (no updatable cols or audit_logs): do nothing on duplicate
  if (updatableCols.length === 0 || tableName.toLowerCase() === 'audit_logs') {
    const noopCol = columns[0];
    return `INSERT INTO \`${tableName}\` (${colListSql}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE \`${noopCol}\` = \`${noopCol}\``;
  }

  let updateClause;
  if (hasUpdatedAt) {
    updateClause = updatableCols
      .map(
        (c) =>
          `\`${c}\` = IF(COALESCE(VALUES(\`updated_at\`), '1970-01-01 00:00:00') >= COALESCE(\`updated_at\`, '1970-01-01 00:00:00'), VALUES(\`${c}\`), \`${c}\`)`
      )
      .join(', ');
  } else {
    updateClause = updatableCols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ');
  }

  return `INSERT INTO \`${tableName}\` (${colListSql}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateClause}`;
}
