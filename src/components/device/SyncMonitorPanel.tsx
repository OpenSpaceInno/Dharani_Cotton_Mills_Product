import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Play,
  ShieldCheck,
  XCircle,
  Lock,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from 'sonner';

function formatDateTime(val?: string | null) {
  if (!val) return '—';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString();
}

export const SyncMonitorPanel: React.FC = () => {
  const [statusData, setStatusData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getSyncStatus();
      setStatusData(data);
    } catch (err: any) {
      toast.error('Failed to load sync status: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleManualSync = async () => {
    try {
      setTriggering(true);
      const res = await api.triggerManualSync();
      const rep = res.report;
      if (rep?.skipped) {
        toast.info(`Sync skipped (${rep.reason})`);
      } else if (rep?.status === 'success' || rep?.status === 'clean_no_changes') {
        toast.success(
          `Sync completed: +${rep.totalInserted || 0} inserted, ~${rep.totalUpdated || 0} updated, -${rep.totalDeleted || 0} deleted`
        );
      } else {
        toast.warning(`Sync finished with status: ${rep?.status || 'unknown'}`);
      }
      await loadStatus();
    } catch (err: any) {
      toast.error('Manual sync failed: ' + err.message);
    } finally {
      setTriggering(false);
    }
  };

  const status = statusData?.status || 'idle';
  const statusBadgeClass =
    status === 'healthy' || status === 'success' || status === 'idle' || status === 'clean_no_changes'
      ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
      : status === 'running'
      ? 'bg-blue-500/15 text-blue-600 border-blue-500/30'
      : status === 'offline_queued'
      ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
      : 'bg-destructive/15 text-destructive border-destructive/30';

  const recentLogs: any[] = Array.isArray(statusData?.recentLogs) ? statusData.recentLogs : [];
  const tableWatermarks: any[] = Array.isArray(statusData?.tables) ? statusData.tables : [];
  const excludedTables: Array<{ table: string; reason: string }> = Array.isArray(statusData?.excludedTables)
    ? statusData.excludedTables
    : [];

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card p-4 rounded-xl border border-border">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Automated Local-to-Server MySQL Synchronization
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Silent background incremental replication (every {statusData?.intervalMinutes || 5} minutes) with transaction safety and duplicate prevention.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading} className="text-xs">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleManualSync} disabled={triggering || statusData?.isCurrentlySyncing} className="text-xs">
            <Play className="h-3.5 w-3.5 mr-1.5" />
            {triggering ? 'Syncing...' : 'Run Sync Now'}
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Current Sync Status</CardDescription>
            <CardTitle className="text-base flex items-center justify-between">
              <Badge variant="outline" className={statusBadgeClass}>
                {status.toUpperCase()}
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">{statusData?.channel || statusData?.mode || 'none'}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 font-mono truncate" title={statusData?.sourceDatabase}>
              <span>{statusData?.sourceDatabase || 'localhost/dharani_weighbridge'}</span>
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span>{statusData?.targetDatabase || 'unconfigured'}</span>
            </div>
            <div>Background Scheduler: {statusData?.enabled ? 'Active' : 'Disabled'}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Last Successful Sync
            </CardDescription>
            <CardTitle className="text-sm font-mono">{formatDateTime(statusData?.lastSuccessAt)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Last Sync ID: <span className="font-mono text-foreground">{statusData?.lastSyncId || '—'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
              Next Scheduled Sync
            </CardDescription>
            <CardTitle className="text-sm font-mono">{formatDateTime(statusData?.nextScheduledAt)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Interval: Every {statusData?.intervalMinutes || 5} min (silent background)
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Cumulative Record Counters</CardDescription>
            <CardTitle className="text-sm font-mono flex items-center gap-3">
              <span className="text-emerald-600">+{statusData?.totals?.inserted ?? 0}</span>
              <span className="text-blue-600">~{statusData?.totals?.updated ?? 0}</span>
              <span className="text-amber-600">-{statusData?.totals?.deleted ?? 0}</span>
              <span className="text-destructive">!{statusData?.totals?.failed ?? 0}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Inserted / Updated / Deleted / Failed
          </CardContent>
        </Card>
      </div>

      {/* Sync Execution Logs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold">Synchronization Execution Logs</CardTitle>
          <CardDescription className="text-xs">
            Audited history of background incremental cycles (passwords and connection secrets are never logged).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium">
                <tr>
                  <th className="px-3 py-2">Sync ID</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Completed</th>
                  <th className="px-3 py-2">Route</th>
                  <th className="px-3 py-2 text-right">Checked</th>
                  <th className="px-3 py-2 text-right">Inserted</th>
                  <th className="px-3 py-2 text-right">Updated</th>
                  <th className="px-3 py-2 text-right">Deleted</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentLogs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                      No synchronization cycles recorded yet.
                    </td>
                  </tr>
                ) : (
                  recentLogs.map((log) => (
                    <tr key={log.sync_id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono">{log.sync_id}</td>
                      <td className="px-3 py-2 font-mono">{formatDateTime(log.started_at)}</td>
                      <td className="px-3 py-2 font-mono">{formatDateTime(log.completed_at)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {log.source_db} → {log.destination_db}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{log.total_checked}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-600">{log.inserted_count}</td>
                      <td className="px-3 py-2 text-right font-mono text-blue-600">{log.updated_count}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-600">{log.deleted_count}</td>
                      <td className="px-3 py-2 text-right font-mono text-destructive">{log.failed_count}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {log.status}
                        </Badge>
                        {log.error_details && (
                          <div className="text-[10px] text-destructive mt-1 max-w-[240px] truncate" title={log.error_details}>
                            {log.error_details}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Watermarks & Security Policy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Table Checkpoints (Watermarks)
            </CardTitle>
            <CardDescription className="text-xs">
              Incremental checkpoints updated only after successful destination commits.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto max-h-72">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium sticky top-0">
                  <tr>
                    <th className="px-3 py-2">Table</th>
                    <th className="px-3 py-2">Last Watermark</th>
                    <th className="px-3 py-2 text-right">Synced</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tableWatermarks.map((t) => (
                    <tr key={t.table_name}>
                      <td className="px-3 py-1.5 font-mono">{t.table_name}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px]">{formatDateTime(t.last_synced_at)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{t.total_synced}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {t.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Lock className="h-4 w-4 text-amber-500" />
              Excluded Sensitive Tables & Integrity Guard
            </CardTitle>
            <CardDescription className="text-xs">
              Tables and secret columns intentionally excluded from replication for security.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {excludedTables.map((ex) => (
              <div key={ex.table} className="p-2 rounded-md border bg-muted/30 flex items-start gap-2">
                <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-mono font-semibold">{ex.table}</span>
                  <p className="text-muted-foreground text-[11px]">{ex.reason}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
