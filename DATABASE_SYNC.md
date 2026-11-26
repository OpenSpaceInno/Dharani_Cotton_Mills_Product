# Automated Local-to-Server MySQL Synchronization

## Architecture

Synchronization flows strictly in one direction:

`LOCAL MYSQL (Plant Edge) -> BACKGROUND SYNC ENGINE -> SERVER MYSQL (Production)`

### Why Popup Windows Were Eliminated

Previously, `scripts/register-sync-task.ps1` registered a Windows Scheduled Task (`WeighbridgeRMC_DatabaseSync`) that launched `scripts/run-sync-task.bat` every 5 minutes, causing visible command-prompt popups.

That mechanism has been completely removed:
- `WeighbridgeRMC_DatabaseSync` task unregistered and `run-sync-task.bat` deleted.
- Synchronization now runs **silently inside the Node.js background service**:
  - In local development: inside the backend process (`SYNC_RUN_SCHEDULER=true`).
  - In Docker Compose: inside the dedicated `sync-worker` container (`node sync-worker.js`), while `backend` sets `SYNC_RUN_SCHEDULER=false`.
- A MySQL advisory lock (`GET_LOCK('dharani_db_sync_lock', 0)`) ensures multiple workers or manual triggers can never overlap.

## Incremental Sync & Duplicate Prevention

- **Pagination Cursor:** Uses `(watermark_column, pk_column)` ordering (`updated_at > last_synced_at OR (updated_at = last_synced_at AND pk > last_synced_pk)`), processing batches of 200 rows per table without skipping rows that share the same timestamp.
- **Topological Parent-First Order:** Parent tables (`camera_devices`, `anpr_events`, `weighbridge_sessions`) synchronize before child tables (`device_rtsp_config`, `device_network_config`, `anpr_config`, `anpr_evidence`, `weigh_slips`).
- **Conflict-Safe UPSERT:** Uses `INSERT ... ON DUPLICATE KEY UPDATE` with an `updated_at` timestamp guard (`VALUES(updated_at) >= COALESCE(updated_at, '1970-01-01 00:00:00')`) so newer server records are never overwritten by older local records, and surrogate auto-increment IDs are omitted on tables with business unique keys (`anpr_events.event_id`, `camera_devices.device_id`, `report_field_configs`).
- **Deletion Propagation:** Deletions on eligible configuration tables record a row in `sync_tombstones` and propagate safely in the next cycle.
- **Checkpoints & Transactions:** Destination writes run inside a database transaction (`COMMIT` / `ROLLBACK`). Local `edge_sync_tracking` checkpoints advance **only after** the remote transaction commits.

## Data Safety & Excluded Tables

Configured in `server/config/sync-config.js`:
- **Excluded Tables:** `users` (contains `password_hash`), `device_ftp_config`, `ftp_configs` (plaintext FTP/admin passwords), `sap_connection_config`, and internal sync metadata tables (`edge_sync_tracking`, `sync_logs`, `sync_tombstones`).
- **Excluded Columns:** `device_rtsp_config.password` and `anpr_config.api_key` are stripped before transmission.

## Monitoring & Verification

- **UI Dashboard:** Open **Device Config → DB Sync Monitor** in the web app to view current status, last successful sync, next scheduled sync, inserted/updated/deleted/failed totals, per-table watermarks, and `sync_logs` execution history.
- **API Endpoints:**
  - `GET /api/sync/status`
  - `GET /api/sync/logs`
  - `GET /api/sync/config`
  - `POST /api/sync/trigger` (optional manual trigger)
- **Log File:** `logs/cloud-sync.log` (automatically rotated at 10 MB; credentials are never logged).

## Troubleshooting

1. **Destination unreachable (`offline_queued`):**
   - Local operations continue uninterrupted.
   - Checkpoints are not advanced, so all pending changes automatically catch up on the next 5-minute cycle when connectivity returns.
2. **Legacy popup still appearing on an older machine:**
   Run in PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/register-sync-task.ps1
   ```
