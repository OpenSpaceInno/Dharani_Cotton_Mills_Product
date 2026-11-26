# ==============================================================================
# Weighbridge RMC - Legacy Windows Scheduled Task Cleanup
# ==============================================================================
# Previously, this script registered a Windows Task Scheduler job running a
# batch file every 5 minutes, which caused a visible console window popup.
#
# Synchronization now runs SILENTLY in the background via the Node.js backend
# scheduler (or dedicated Docker sync-worker service) with ZERO popups.
# Run this script only to remove any leftover legacy scheduled task.
# ==============================================================================

$taskName = "WeighbridgeRMC_DatabaseSync"

Write-Host "Checking for legacy scheduled task '$taskName'..." -ForegroundColor Cyan
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed legacy scheduled task '$taskName' (no more 5-minute popups)." -ForegroundColor Green
} else {
    Write-Host "No legacy scheduled task '$taskName' found. Already clean." -ForegroundColor Green
}

Write-Host "Database synchronization runs automatically in the background via the backend / sync-worker service." -ForegroundColor Gray
