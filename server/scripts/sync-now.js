import '../config/env.js';
import { cloudSyncService } from '../cloud-sync-service.js';
import { pool } from '../db.js';

async function main() {
  console.log('===============================================================');
  console.log(' Weighbridge RMC - One-Shot Database Synchronization');
  console.log(` Source:      ${cloudSyncService.getSourceLabel()}`);
  console.log(` Destination: ${cloudSyncService.getDestinationLabel()}`);
  console.log('===============================================================');

  try {
    await pool.query('SELECT 1');
    console.log('✅ Local MySQL connection verified.');

    await cloudSyncService.initialize({ startScheduler: false });
    console.log('🚀 Running synchronization cycle...');

    const result = await cloudSyncService.runSyncCycle();

    console.log('---------------------------------------------------------------');
    console.log(`Sync ID:          ${result.syncId || 'N/A'}`);
    console.log(`Status:           ${result.status || result.reason}`);
    console.log(`Channel Used:     ${result.channel || 'None'}`);
    console.log(`Records Checked:  ${result.totalChecked || 0}`);
    console.log(`Records Inserted: ${result.totalInserted || 0}`);
    console.log(`Records Updated:  ${result.totalUpdated || 0}`);
    console.log(`Records Deleted:  ${result.totalDeleted || 0}`);
    console.log(`Records Unchanged:${result.totalUnchanged || 0}`);
    console.log(`Records Failed:   ${result.totalFailed || 0}`);

    if (result.tableDetails && Object.keys(result.tableDetails).length > 0) {
      console.log('\nPer-Table Breakdown:');
      for (const [tbl, stats] of Object.entries(result.tableDetails)) {
        console.log(`  - ${tbl.padEnd(28)}: +${stats.inserted || 0} inserted, ~${stats.updated || 0} updated, =${stats.unchanged || 0} unchanged`);
      }
    }

    if (result.errors && result.errors.length > 0) {
      console.error('\n⚠️ Errors encountered:');
      result.errors.forEach((err) => console.error(`  - ${err}`));
    }

    console.log('---------------------------------------------------------------');

    await cloudSyncService.closePools();
    await pool.end();

    if (result.status === 'success' || result.status === 'clean_no_changes' || result.skipped) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Fatal error running synchronization:', err);
    process.exit(1);
  }
}

main();
