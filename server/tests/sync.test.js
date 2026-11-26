import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_ELIGIBLE_TABLES,
  SYNC_EXCLUDED_TABLES,
  getSyncTableConfig,
  sanitizeRowForSync,
  buildConflictSafeUpsertSql,
} from '../config/sync-config.js';
import { sanitizeValueForMysql, CloudSyncService } from '../cloud-sync-service.js';

test('Sync configuration enforces parent-first topological order', () => {
  const indexOf = (name) => SYNC_ELIGIBLE_TABLES.findIndex((t) => t.table === name);
  assert.ok(indexOf('camera_devices') < indexOf('device_network_config'));
  assert.ok(indexOf('camera_devices') < indexOf('device_rtsp_config'));
  assert.ok(indexOf('camera_devices') < indexOf('anpr_config'));
  assert.ok(indexOf('anpr_events') < indexOf('anpr_evidence'));
  assert.ok(indexOf('weighbridge_sessions') <= indexOf('weigh_slips'));
});

test('Sensitive authentication and FTP credential tables are excluded', () => {
  const excludedNames = new Set(SYNC_EXCLUDED_TABLES.map((t) => t.table));
  assert.ok(excludedNames.has('users'));
  assert.ok(excludedNames.has('device_ftp_config'));
  assert.ok(excludedNames.has('ftp_configs'));
  assert.equal(getSyncTableConfig('users'), null);
  assert.equal(getSyncTableConfig('ftp_configs'), null);
});

test('sanitizeRowForSync strips surrogate IDs and sensitive columns', () => {
  const rtspCfg = getSyncTableConfig('device_rtsp_config');
  const sanitized = sanitizeRowForSync(rtspCfg, {
    id: 'local-uuid-123',
    device_id: 'cam_gate_1',
    password: 'super_secret_camera_pw',
    port: 554,
  });
  assert.equal(sanitized.id, undefined);
  assert.equal(sanitized.password, undefined);
  assert.equal(sanitized.device_id, 'cam_gate_1');
  assert.equal(sanitized.port, 554);
});

test('buildConflictSafeUpsertSql protects primary keys, newer timestamps, and orders updated_at last', () => {
  const cfg = getSyncTableConfig('weighbridge_sessions');
  const sql = buildConflictSafeUpsertSql(
    'weighbridge_sessions',
    ['session_id', 'updated_at', 'party_name', 'net_weight'],
    ['session_id'],
    cfg
  );
  assert.match(sql, /ON DUPLICATE KEY UPDATE/i);
  assert.doesNotMatch(sql, /`session_id` = /);
  assert.match(sql, /COALESCE\(VALUES\(`updated_at`\), '1970-01-01 00:00:00'\) >= COALESCE\(`updated_at`/);
  assert.ok(sql.lastIndexOf('`updated_at` = IF(') > sql.lastIndexOf('`net_weight` = IF('));
});

test('sanitizeValueForMysql preserves Date objects and ISO strings cleanly', () => {
  assert.equal(sanitizeValueForMysql('2026-11-26T10:15:30.000Z'), '2026-11-26 10:15:30');
  assert.equal(sanitizeValueForMysql(true), 1);
  assert.equal(sanitizeValueForMysql(false), 0);
  assert.equal(sanitizeValueForMysql(null), null);
});

test('CloudSyncService rejects self-sync target and masks credentials in labels', () => {
  const svc = new CloudSyncService({
    sourceHost: 'localhost',
    sourcePort: 3306,
    sourceDatabase: 'dharani_weighbridge',
    remoteHost: '127.0.0.1',
    remotePort: 3306,
    remoteUser: 'root',
    remotePassword: 'secret_password_123',
    remoteDatabase: 'dharani_weighbridge',
  });
  assert.equal(svc.isSelfTarget(), true);
  assert.equal(svc.hasValidTarget(), false);
  assert.doesNotMatch(svc.getDestinationLabel(), /secret_password_123/);
});
