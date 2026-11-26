import './config/env.js';
import { cloudSyncService } from './cloud-sync-service.js';

/**
 * Dedicated Background Synchronization Worker
 * ============================================================================
 * Runs silently as a standalone service (e.g. Docker `sync-worker` container
 * or background daemon) executing incremental LOCAL -> SERVER MySQL sync
 * every 5 minutes (CLOUD_SYNC_INTERVAL_MS=300000).
 * ============================================================================
 */
async function main() {
  console.log('===============================================================');
  console.log(' Dharani Weighbridge - Background MySQL Sync Worker');
  console.log(` Source:      ${cloudSyncService.getSourceLabel()}`);
  console.log(` Destination: ${cloudSyncService.getDestinationLabel()}`);
  console.log(` Interval:    ${Math.round(cloudSyncService.intervalMs / 1000)}s`);
  console.log('===============================================================');

  await cloudSyncService.initialize({ startScheduler: true });

  const shutdown = async (signal) => {
    console.log(`\n[Sync Worker] Received ${signal}, shutting down gracefully...`);
    await cloudSyncService.closePools();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Sync worker fatal error:', err);
  process.exit(1);
});
