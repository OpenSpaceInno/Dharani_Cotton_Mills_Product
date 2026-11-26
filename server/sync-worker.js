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

  // Wait cleanly for MySQL readiness during cold Docker/Coolify boots
  const maxDbAttempts = Number(process.env.DB_STARTUP_RETRIES) || 24;
  const retryDelayMs = Number(process.env.DB_STARTUP_RETRY_DELAY_MS) || 2500;
  for (let attempt = 1; attempt <= maxDbAttempts; attempt += 1) {
    try {
      await cloudSyncService.sourcePool.query('SELECT 1');
      break;
    } catch (err) {
      if (attempt < maxDbAttempts) {
        console.log(`⏳ Sync Worker waiting for MySQL (${attempt}/${maxDbAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  await cloudSyncService.initialize({ startScheduler: true });

  // Keep container alive cleanly when sync target is not configured (e.g. standalone server deployment)
  const keepAliveTimer = setInterval(() => {}, 60000);

  const shutdown = async (signal) => {
    clearInterval(keepAliveTimer);
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
