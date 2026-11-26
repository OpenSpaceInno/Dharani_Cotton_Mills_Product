import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export interface DashboardScale {
  liveWeight: number;
  unit: string;
  stable: boolean;
  zero: boolean;
  serialConnected: boolean;
  port: string;
  model: string;
}

export interface PendingQueueItem {
  sessionId: string;
  transactionNo: number;
  vehicleNo: string;
  partyName: string;
  material: string;
  firstWeight: number;
  firstWeightTime: string;
  waitMinutes: number;
}

export interface ProductBreakdownItem {
  product: string;
  count: number;
  netKg: number;
}

export interface GateScanItem {
  id: string | number;
  event_id?: string;
  camera_id?: string;
  vehicle_reg_no?: string;
  direction?: string;
  confidence?: string | number;
  status?: string;
  created_at?: string;
}

export interface DashboardStats {
  todayTransactions: number;
  completedWeighments: number;
  pendingSecondWeight: number;
  pendingFirstWeight: number;
  gateScansToday: number;
  camerasOnline: number;
  totalCameras: number;
  totalWeightMT: number;
  totalGrossKg: number;
  totalNetKg: number;
  totalCharges: number;
}

export interface HourlyActivityData {
  hour: string;
  weighments: number;
  gateReads: number;
}

export const useDashboard = () => {
  const [stats, setStats] = useState<DashboardStats>({
    todayTransactions: 0,
    completedWeighments: 0,
    pendingSecondWeight: 0,
    pendingFirstWeight: 0,
    gateScansToday: 0,
    camerasOnline: 2,
    totalCameras: 2,
    totalWeightMT: 0,
    totalGrossKg: 0,
    totalNetKg: 0,
    totalCharges: 0,
  });

  const [scale, setScale] = useState<DashboardScale>({
    liveWeight: 0,
    unit: 'kg',
    stable: true,
    zero: true,
    serialConnected: true,
    port: 'COM3',
    model: 'Ventek VMS-WB',
  });

  const [pendingQueue, setPendingQueue] = useState<PendingQueueItem[]>([]);
  const [productBreakdown, setProductBreakdown] = useState<ProductBreakdownItem[]>([]);
  const [recentScans, setRecentScans] = useState<GateScanItem[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyActivityData[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [systemHealth, setSystemHealth] = useState<any>({
    camerasOnline: 2,
    totalCameras: 2,
    cloudSyncEnabled: true,
    lastCloudSync: null,
    auditCountToday: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getDashboardSummary().catch(() => null);

      if (res) {
        if (res.scale) {
          setScale({
            liveWeight: Number(res.scale.liveWeight || 0),
            unit: res.scale.unit || 'kg',
            stable: Boolean(res.scale.stable),
            zero: Boolean(res.scale.zero),
            serialConnected: Boolean(res.scale.serialConnected),
            port: res.scale.port || 'COM3',
            model: res.scale.model || 'VMS-WB',
          });
        }

        if (res.weighbridge) {
          setStats({
            todayTransactions: res.weighbridge.totalSessions || 0,
            completedWeighments: res.weighbridge.completedCount || 0,
            pendingSecondWeight: res.weighbridge.pending2ndCount || 0,
            pendingFirstWeight: 0,
            gateScansToday: res.gate?.totalScans || 0,
            camerasOnline: res.system?.camerasOnline || 2,
            totalCameras: res.system?.totalCameras || 2,
            totalWeightMT: res.weighbridge.totalNetMT || 0,
            totalGrossKg: res.weighbridge.totalGrossKg || 0,
            totalNetKg: res.weighbridge.totalNetKg || 0,
            totalCharges: res.weighbridge.totalCharges || 0,
          });

          setPendingQueue(Array.isArray(res.weighbridge.pendingQueue) ? res.weighbridge.pendingQueue : []);
          setProductBreakdown(Array.isArray(res.weighbridge.productBreakdown) ? res.weighbridge.productBreakdown : []);
          setRecentTransactions(Array.isArray(res.weighbridge.recentTransactions) ? res.weighbridge.recentTransactions : []);
        }

        if (res.gate) {
          setRecentScans(Array.isArray(res.gate.recentScans) ? res.gate.recentScans : []);
        }

        if (res.system) {
          setSystemHealth(res.system);
        }

        if (Array.isArray(res.hourlyActivity)) {
          setHourlyData(res.hourlyActivity);
        }
      }
    } catch (e) {
      console.warn('Dashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    // Live polling every 5 seconds for real-time scale & queue updates
    const interval = setInterval(fetchDashboardData, 5000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  return {
    stats,
    scale,
    pendingQueue,
    productBreakdown,
    recentScans,
    hourlyData,
    recentTransactions,
    systemHealth,
    loading,
    refresh: fetchDashboardData,
  };
};
