import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { WeightReading, WeighbridgeSession, WeighSlip, Evidence, PrintOptions } from '@/types/weighbridge';
import { api } from '@/lib/api';
import { useCompany } from '@/contexts/CompanyContext';
import { formatToDDMMYYYY, formatToHHMMSS, getCurrentDateTimeStamp } from '@/utils/dateTimeFormatters';
import { toast } from '@/hooks/use-toast';

const STORAGE_KEY_SESSIONS = 'rmc_weighbridge_data';

// Auto-purge any stale legacy mock records (transactions >= 100) from browser localStorage
if (typeof window !== 'undefined') {
  try {
    const rawSessions = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (rawSessions && (rawSessions.includes('"transactionNo":2') || rawSessions.includes('"transaction_no":2'))) {
      const parsed = JSON.parse(rawSessions);
      if (Array.isArray(parsed) && parsed.some((s: any) => Number(s.transactionNo) >= 100)) {
        localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(parsed.filter((s: any) => Number(s.transactionNo) < 100)));
      }
    }
    const rawPending = localStorage.getItem('rmc_pending_vehicles');
    if (rawPending && (rawPending.includes('"transactionNo":2') || rawPending.includes('"transaction_no":2'))) {
      const parsed = JSON.parse(rawPending);
      if (Array.isArray(parsed) && parsed.some((p: any) => Number(p.transactionNo) >= 100)) {
        localStorage.setItem('rmc_pending_vehicles', JSON.stringify(parsed.filter((p: any) => Number(p.transactionNo) < 100)));
      }
    }
  } catch (e) {}
}

export interface TerminalFormData {
  transactionNo: number;
  vehicleRegNo: string;
  partyName: string;
  product: string;
  status: string;
  locationName: string;
  cultivatorName: string;
  loadSlipNo: string;
  bagsBales: string;
  charges: number;
  rate: number;
  moisture: number;
  chessNo: string;
  chessName: string;
  chessAmount: number;
  village: string;
  mobileNo: string;
  firstWeight: number | null;
  firstWeightDate: string;
  firstWeightTime: string | null;
  secondWeight: number | null;
  secondWeightDate: string;
  secondWeightTime: string | null;
  secondWeightRequired: boolean;
  printDuplicate: boolean;
  printQrCode: boolean;
  printImages: boolean;
  // Optional / backward-compatible fields:
  firmName?: string;
  fatherName?: string;
  deduction?: number;
  vehicleType?: string;
  agent?: string;
}

const initialForm: TerminalFormData = {
  transactionNo: 1,
  vehicleRegNo: '',
  partyName: '',
  product: '',
  status: 'Inward',
  locationName: '',
  cultivatorName: '',
  loadSlipNo: '',
  bagsBales: '',
  charges: 0,
  rate: 0,
  moisture: 0,
  chessNo: '',
  chessName: '',
  chessAmount: 0,
  village: '',
  mobileNo: '',
  firstWeight: null,
  firstWeightDate: '',
  firstWeightTime: null,
  secondWeight: null,
  secondWeightDate: '',
  secondWeightTime: null,
  secondWeightRequired: true,
  printDuplicate: false,
  printQrCode: false,
  printImages: true,
  firmName: '',
  fatherName: '',
  deduction: 0,
  vehicleType: '',
  agent: '',
};

export const useWeighbridge = () => {
  const { company } = useCompany();
  const [currentWeight, setCurrentWeight] = useState<WeightReading>({
    timestamp: new Date().toISOString(),
    weight: 0,
    unit: 'kg',
    stable: true,
    zero: true,
  });

  const [formData, setFormData] = useState<TerminalFormData>(() => ({
    ...initialForm,
    printImages: company.weighbridgeDefaults?.printImages ?? true,
  }));

  // Automatically sync Print Images across all roles whenever Admin updates company defaults
  useEffect(() => {
    const globalPrintImages = company.weighbridgeDefaults?.printImages ?? true;
    setFormData((prev) =>
      prev.printImages === globalPrintImages ? prev : { ...prev, printImages: globalPrintImages }
    );
  }, [company.weighbridgeDefaults?.printImages]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([
    {
      id: 'ev-1',
      type: 'image',
      url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=300&auto=format&fit=crop&q=60',
      angle: 'front',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'ev-2',
      type: 'image',
      url: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=300&auto=format&fit=crop&q=60',
      angle: 'side',
      timestamp: new Date().toISOString(),
    },
  ]);

  const [sessions, setSessions] = useState<WeighbridgeSession[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Permanently filter out any legacy mock sessions (>= 100)
          return parsed.filter((s: any) => Number(s.transactionNo) < 100);
        }
      }
    } catch (e) {}
    return [];
  });

  const [pendingVehicles, setPendingVehicles] = useState<WeighbridgeSession[]>(() => {
    try {
      const stored = localStorage.getItem('rmc_pending_vehicles');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Permanently filter out any legacy mock pending vehicles (>= 100)
          return parsed.filter((p: any) => Number(p.transactionNo) < 100);
        }
      }
    } catch (e) {}
    return [];
  });
  const [activeSlip, setActiveSlip] = useState<WeighSlip | null>(null);
  const [loadedPendingTxNo, setLoadedPendingTxNo] = useState<number | null>(null);
  const [f3FirstWeightTxNo, setF3FirstWeightTxNo] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savedParties, setSavedParties] = useState<any[]>([]);

  // Gate Monitor Auto-Fetch & Real-Time Sync State
  const [latestGateVehicle, setLatestGateVehicle] = useState<{
    vehicleRegNo: string;
    confidence: number;
    timestamp?: string;
    source?: string;
    matchedVehicle?: any;
  } | null>(null);

  const [recentGateVehicles, setRecentGateVehicles] = useState<any[]>([]);
  const [autoSyncGateVehicle, setAutoSyncGateVehicle] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('rmc_auto_sync_gate');
      return stored === 'true';
    } catch {
      return false;
    }
  });

  const handleSetAutoSync = useCallback((enabled: boolean) => {
    setAutoSyncGateVehicle(enabled);
    try {
      localStorage.setItem('rmc_auto_sync_gate', String(enabled));
    } catch (e) {}
  }, []);

  // Load a vehicle from Today Pending Vehicles drawer
  const loadPendingVehicle = useCallback((session: WeighbridgeSession) => {
    const { dateStr, timeStr } = getCurrentDateTimeStamp();
    const liveScale = currentWeight.weight > 0 ? currentWeight.weight : null;

    setLoadedPendingTxNo(Number(session.transactionNo) || null);
    setF3FirstWeightTxNo(null);
    setFormData((prev) => ({
      ...prev,
      transactionNo: session.transactionNo || prev.transactionNo,
      vehicleRegNo: session.vehicleRegNo,
      partyName: session.partyName || prev.partyName,
      product: session.product || session.material || prev.product,
      firmName: session.firmName || prev.firmName,
      locationName: session.locationName || (session as any).location_name || prev.locationName,
      cultivatorName: session.cultivatorName || (session as any).cultivator_name || prev.cultivatorName,
      loadSlipNo: session.loadSlipNo || (session as any).load_slip_no || prev.loadSlipNo,
      bagsBales: session.bagsBales || prev.bagsBales,
      fatherName: session.fatherName || (session as any).father_name || '',
      mobileNo: session.mobileNo || (session as any).mobile_no || prev.mobileNo,
      firstWeight: session.firstWeight ?? (session.status === 'Outward' ? session.tareWeight : session.grossWeight) ?? session.tareWeight ?? session.grossWeight ?? null,
      firstWeightDate: formatToDDMMYYYY((session as any).firstWeightDate || (session as any).first_weight_date || session.firstWeightTime || session.timestamp),
      firstWeightTime: formatToHHMMSS(session.firstWeightTime || session.timestamp),
      secondWeight: session.secondWeight ?? liveScale,
      secondWeightDate: (session.secondWeight !== null && session.secondWeight !== undefined)
        ? formatToDDMMYYYY((session as any).secondWeightDate || (session as any).second_weight_date || session.secondWeightTime)
        : dateStr,
      secondWeightTime: (session.secondWeight !== null && session.secondWeight !== undefined)
        ? formatToHHMMSS(session.secondWeightTime)
        : timeStr,
      secondWeightRequired: true,
      status: session.status || prev.status || 'Inward',
      rate: session.rate ?? prev.rate,
      moisture: session.moisture ?? prev.moisture,
      deduction: session.deduction ?? prev.deduction,
      charges: session.charges ?? prev.charges,
      vehicleType: session.vehicleType || prev.vehicleType,
      agent: session.agent || prev.agent,
      village: session.village || prev.village,
      chessNo: session.chessNo || prev.chessNo,
      chessAmount: session.chessAmount ?? prev.chessAmount,
      chessName: session.chessName || prev.chessName,
    }));
    if (session.evidence && Array.isArray(session.evidence) && session.evidence.length > 0) {
      setEvidenceList(session.evidence);
    }
  }, [currentWeight.weight]);

  // Load a full session (from database or sessions archive)
  const loadFullSession = useCallback((session: WeighbridgeSession) => {
    setLoadedPendingTxNo(null);
    setF3FirstWeightTxNo(null);
    setFormData((prev) => ({
      ...prev,
      transactionNo: session.transactionNo || prev.transactionNo,
      vehicleRegNo: session.vehicleRegNo,
      partyName: session.partyName || prev.partyName,
      product: session.product || session.material || prev.product,
      firmName: session.firmName || prev.firmName,
      locationName: session.locationName || (session as any).location_name || prev.locationName,
      cultivatorName: session.cultivatorName || (session as any).cultivator_name || prev.cultivatorName,
      loadSlipNo: session.loadSlipNo || (session as any).load_slip_no || prev.loadSlipNo,
      bagsBales: session.bagsBales || prev.bagsBales,
      fatherName: session.fatherName || (session as any).father_name || '',
      mobileNo: session.mobileNo || (session as any).mobile_no || prev.mobileNo,
      status: session.status || (session.secondWeight ? 'completed' : 'pending_2nd_weight'),
      firstWeight: session.firstWeight ?? session.tareWeight ?? null,
      firstWeightDate: formatToDDMMYYYY((session as any).firstWeightDate || (session as any).first_weight_date || session.firstWeightTime || session.timestamp),
      firstWeightTime: formatToHHMMSS(session.firstWeightTime || session.timestamp),
      secondWeight: session.secondWeight ?? session.grossWeight ?? null,
      secondWeightDate: (session.secondWeight !== null && session.secondWeight !== undefined) || (session.grossWeight !== null && session.grossWeight !== undefined) ? formatToDDMMYYYY((session as any).secondWeightDate || (session as any).second_weight_date || session.secondWeightTime) : '',
      secondWeightTime: (session.secondWeight !== null && session.secondWeight !== undefined) || (session.grossWeight !== null && session.grossWeight !== undefined) ? formatToHHMMSS(session.secondWeightTime) : null,
      rate: session.rate ?? prev.rate,
      moisture: session.moisture ?? prev.moisture,
      deduction: session.deduction ?? prev.deduction,
      charges: session.charges ?? prev.charges,
      vehicleType: session.vehicleType || prev.vehicleType,
      agent: session.agent || prev.agent,
      village: session.village || prev.village,
      chessNo: session.chessNo || prev.chessNo,
      chessAmount: session.chessAmount ?? prev.chessAmount,
      chessName: session.chessName || prev.chessName,
    }));
    if (session.evidence && Array.isArray(session.evidence) && session.evidence.length > 0) {
      setEvidenceList(session.evidence);
    }
  }, []);

  // Check if a vehicle registration number has an active pending transaction and link it
  const linkVehicleIfPending = useCallback(async (vehicleNo: string): Promise<WeighbridgeSession | null> => {
    if (!vehicleNo) return null;
    const clean = vehicleNo.replace(/[\s\-_]/g, '').toUpperCase();
    let matched = pendingVehicles.find(
      (p) => (p.vehicleRegNo || '').replace(/[\s\-_]/g, '').toUpperCase() === clean
    ) || null;

    if (!matched) {
      matched = sessions.find(
        (s) => (s.vehicleRegNo || '').replace(/[\s\-_]/g, '').toUpperCase() === clean &&
               (s.firstWeight !== null || s.tareWeight !== null) &&
               (!s.secondWeight || s.status === 'pending_2nd_weight')
      ) || null;
    }

    if (!matched) {
      try {
        const res = await api.getPendingVehicleByNo(clean);
        if (res && res.success && res.session) {
          matched = res.session;
        }
      } catch (e) {}
    }

    if (matched) {
      loadPendingVehicle(matched);
      return matched;
    }
    return null;
  }, [pendingVehicles, sessions, loadPendingVehicle]);

  // Function to apply a gate vehicle to form (links pending vehicle if one exists) & sets Gate Evidence Snapshot
  const applyGateVehicle = useCallback((veh: { vehicleRegNo: string; matchedVehicle?: any; imageUrl?: string; evidenceImageUrl?: string; fileName?: string }) => {
    if (!veh || !veh.vehicleRegNo) return;
    const cleanReg = veh.vehicleRegNo.trim().toUpperCase();

    // 1. Show Gate Monitor vehicle snapshot as "Vehicle Evidence" snapshot (Slot 0 / angle: 'front')
    const evUrl = veh.imageUrl || veh.evidenceImageUrl || (veh.fileName ? `/snapshots/${veh.fileName}` : '');
    if (evUrl) {
      setEvidenceList((prev) => {
        const others = prev.filter(e => e.id !== 'gate-evidence-slot');
        const gateEvItem: Evidence = {
          id: 'gate-evidence-slot',
          type: 'image',
          url: evUrl,
          angle: 'front', // Corresponds to Slot 0: "Vehicle Evidence"
          timestamp: new Date().toISOString(),
        };
        return [gateEvItem, ...others.slice(0, 2)];
      });
    }

    const pendingMatch = pendingVehicles.find(
      (p) => p.vehicleRegNo && p.vehicleRegNo.trim().toUpperCase() === cleanReg
    );
    if (pendingMatch) {
      loadPendingVehicle(pendingMatch);
      if (evUrl) {
        setEvidenceList((prev) => {
          const others = prev.filter(e => e.id !== 'gate-evidence-slot');
          return [{
            id: 'gate-evidence-slot',
            type: 'image',
            url: evUrl,
            angle: 'front',
            timestamp: new Date().toISOString(),
          }, ...others.slice(0, 2)];
        });
      }
      return;
    }

    setFormData((prev) => ({
      ...prev,
      vehicleRegNo: cleanReg,
      partyName: prev.partyName || veh.matchedVehicle?.partyName || '',
      product: prev.product || veh.matchedVehicle?.product || '',
      agent: prev.agent || veh.matchedVehicle?.driverName || '',
      vehicleType: prev.vehicleType || (veh.matchedVehicle?.make ? `${veh.matchedVehicle.make} ${veh.matchedVehicle.model || ''}`.trim() : prev.vehicleType),
    }));
  }, [pendingVehicles, loadPendingVehicle]);

  // Manually fetch and apply latest gate vehicle (with active FTP fallback)
  const fetchAndApplyGateVehicle = useCallback(async () => {
    try {
      let res = await api.getLatestGateVehicle().catch(() => null);
      // If not yet available from standard endpoint, trigger an active FTP sync
      if (!res || !res.success || !res.vehicleRegNo) {
        try {
          const ftpRes = await api.syncFtpNow(true);
          if (ftpRes?.detection?.vehicleRegNo) {
            res = {
              success: true,
              ...ftpRes.detection
            };
          }
        } catch {}
      }

      if (res && res.success && res.vehicleRegNo) {
        setLatestGateVehicle(res as any);
        applyGateVehicle(res);
        return res;
      }
    } catch (err) {
      console.warn('Error fetching latest gate vehicle:', err);
    }
    return null;
  }, [applyGateVehicle]);

  // Synchronize with Gate Monitor module (polling + real-time events)
  useEffect(() => {
    let active = true;

    const syncGate = async () => {
      try {
        const [latestRes, recentRes] = await Promise.all([
          api.getLatestGateVehicle().catch(() => null),
          api.getRecentGateVehicles().catch(() => null),
        ]);

        if (!active) return;

        if (recentRes && recentRes.vehicles) {
          setRecentGateVehicles(recentRes.vehicles);
        }

        const isMock = (plate: string) => ['KA05AB1234', 'MH02CD5678', 'DL01EF9012', 'TN09GH3456', 'GJ06IJ7890', 'MH12AB1234'].includes((plate || '').replace(/\s+/g, '').toUpperCase());

        if (latestRes && latestRes.success && latestRes.vehicleRegNo && !isMock(latestRes.vehicleRegNo)) {
          setLatestGateVehicle(latestRes as any);

          if (autoSyncGateVehicle) {
            applyGateVehicle(latestRes as any);
          }
        }
      } catch (err) {
        // Silently catch network errors
      }
    };

    syncGate();
    const timer = setInterval(syncGate, 3000);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('rmc_gate_sync');
      channel.onmessage = (e) => {
        if (e.data?.type === 'GATE_VEHICLE_CLEARED') {
          setLatestGateVehicle(null);
          return;
        }
        if (e.data && e.data.vehicleRegNo && !isMock(e.data.vehicleRegNo)) {
          const vehData = {
            vehicleRegNo: e.data.vehicleRegNo,
            confidence: e.data.confidence,
            source: 'Gate Monitor Real-Time Broadcast',
            imageUrl: e.data.imageUrl || '',
            evidenceImageUrl: e.data.imageUrl || '',
            timestamp: e.data.timestamp
          };
          setLatestGateVehicle(vehData);
          if (autoSyncGateVehicle) {
            applyGateVehicle(vehData);
          }
        }
      };
    } catch (e) {}

    const handleCustomEvent = (e: any) => {
      if (e.detail && e.detail.vehicleRegNo && !isMock(e.detail.vehicleRegNo)) {
        const vehData = {
          vehicleRegNo: e.detail.vehicleRegNo,
          confidence: e.detail.confidence,
          source: 'Gate Monitor ANPR Event',
          imageUrl: e.detail.imageUrl || '',
          evidenceImageUrl: e.detail.imageUrl || '',
          timestamp: new Date().toISOString()
        };
        setLatestGateVehicle(vehData);
        if (autoSyncGateVehicle) {
          applyGateVehicle(vehData);
        }
      }
    };
    window.addEventListener('rmc_gate_vehicle_detected', handleCustomEvent);

    return () => {
      active = false;
      clearInterval(timer);
      if (channel) channel.close();
      window.removeEventListener('rmc_gate_vehicle_detected', handleCustomEvent);
    };
  }, [autoSyncGateVehicle, applyGateVehicle]);

  // Load next transaction number, pending vehicles, and saved parties from MySQL
  const refreshTerminalData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [txRes, pendingRes, sessionsRes, partiesRes] = await Promise.all([
        api.getNextTransactionNo().catch(() => ({ nextTransactionNo: 1 })),
        api.getPendingVehicles().catch(() => []),
        api.getWeighbridgeSessions().catch(() => []),
        api.getSavedParties().catch(() => []),
      ]);

      if (txRes && txRes.nextTransactionNo) {
        setFormData((prev) => ({
          ...prev,
          transactionNo: (prev.transactionNo && prev.firstWeight !== null) ? prev.transactionNo : txRes.nextTransactionNo,
        }));
      }

      if (Array.isArray(pendingRes)) {
        setPendingVehicles(pendingRes);
        try {
          localStorage.setItem('rmc_pending_vehicles', JSON.stringify(pendingRes));
        } catch (e) {}
      }

      if (Array.isArray(sessionsRes)) {
        setSessions(sessionsRes);
        try {
          localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessionsRes));
        } catch (e) {}
      }

      if (Array.isArray(partiesRes) && partiesRes.length > 0) {
        setSavedParties(partiesRes);
      } else if (Array.isArray(sessionsRes)) {
        // Fallback: extract distinct parties from sessions
        const partyMap = new Map<string, any>();
        sessionsRes.forEach((s: any) => {
          const pName = (s.partyName || s.party_name || '').trim();
          if (pName && !partyMap.has(pName.toLowerCase())) {
            partyMap.set(pName.toLowerCase(), {
              partyName: pName,
              locationName: s.locationName || s.location_name || '',
              cultivatorName: s.cultivatorName || s.cultivator_name || '',
              village: s.village || '',
              mobileNo: s.mobileNo || s.mobile_no || '',
              product: s.product || s.material || '',
              bagsBales: s.bagsBales || s.bags_bales || '',
              rate: s.rate || 0,
              chessName: s.chessName || s.chess_name || '',
              chessNo: s.chessNo || s.chess_no || '',
              chessAmount: s.chessAmount || s.chess_amount || 0,
              charges: s.charges || 0,
              fatherName: s.fatherName || s.father_name || '',
              status: s.status || 'Inward',
            });
          }
        });
        setSavedParties(Array.from(partyMap.values()));
      }
    } catch (err) {
      console.warn('Error fetching terminal data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTerminalData();
  }, [refreshTerminalData]);

  // Live Scale Telemetry: default is strictly 0 (displaying 00000).
  // Polls third-party scale software API/file/TCP monitor every 600ms.
  const isManualOverrideRef = useRef<boolean>(false);

  const setManualWeight = useCallback((weight: number) => {
    isManualOverrideRef.current = true;
    setCurrentWeight({
      timestamp: new Date().toISOString(),
      weight: Math.max(0, weight),
      weightQtl: Number((Math.max(0, weight) / 100).toFixed(2)),
      unit: 'kg',
      stable: true,
      zero: weight === 0,
      connected: true,
      serialPort: 'MANUAL',
      source: 'admin_manual',
      deviceCode: 'MANUAL',
    });
  }, []);

  const clearManualWeight = useCallback(() => {
    isManualOverrideRef.current = false;
    setCurrentWeight({
      timestamp: new Date().toISOString(),
      weight: 0,
      weightQtl: 0,
      unit: 'kg',
      stable: true,
      zero: true,
      connected: false,
      serialPort: 'COM2',
      source: 'ventek_serial',
      deviceCode: 'VMS',
    });
  }, []);

  useEffect(() => {
    let active = true;

    const pollLiveScale = async () => {
      try {
        const reading = await api.getLiveScaleWeight();
        if (active && reading && typeof reading.weight === 'number') {
          // If admin has set manual override, retain admin manual weight
          if (isManualOverrideRef.current) return;
          setCurrentWeight({
            timestamp: reading.timestamp || new Date().toISOString(),
            weight: reading.weight,
            weightQtl: reading.weightQtl !== undefined ? reading.weightQtl : Number((reading.weight / 100).toFixed(2)),
            unit: reading.unit || 'kg',
            stable: reading.stable !== undefined ? reading.stable : true,
            zero: reading.weight === 0,
            connected: reading.connected ?? reading.serialConnected ?? false,
            serialPort: reading.serialPort || 'COM2',
            source: reading.source || 'ventek_serial',
            deviceCode: reading.deviceCode || 'VMS',
          });
        }
      } catch (err) {
        // If third party endpoint has not responded, keep zero reading (00000)
      }
    };

    pollLiveScale();
    const interval = setInterval(pollLiveScale, 600);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const zeroScale = useCallback(async () => {
    isManualOverrideRef.current = false;
    setCurrentWeight({
      timestamp: new Date().toISOString(),
      weight: 0,
      weightQtl: 0,
      unit: 'kg',
      stable: true,
      zero: true,
    });
    try {
      await api.zeroScale();
    } catch (e) {}
  }, []);

  // Auto-populate saved party profile details from database
  const applyPartyDetails = useCallback((partyNameOrObj: string | any, replaceFromSelection = false): boolean => {
    if (!partyNameOrObj) return false;
    const isObjInput = typeof partyNameOrObj === 'object';
    const name = typeof partyNameOrObj === 'string'
      ? partyNameOrObj.trim()
      : (partyNameOrObj.partyName || partyNameOrObj.party_name || '').trim();
    if (!name) return false;

    const clean = name.toLowerCase();

    const normalizeStatus = (rawStatus: any, fallbackStatus: string) => {
      const lower = String(rawStatus || '').trim().toLowerCase();
      if (lower.includes('outward')) return 'Outward';
      if (lower.includes('inward')) return 'Inward';
      return fallbackStatus || 'Inward';
    };

    const applyMatchedProfile = (matched: any, replaceFields: boolean) => {
      setFormData((prev) => {
        const pickText = (primary: any, secondary: any, prevVal: string) => {
          const resolved = (primary ?? secondary ?? '').toString();
          return replaceFields ? resolved : (resolved || prevVal);
        };
        const pickNum = (val: any, prevVal: number) => {
          if (val !== undefined && val !== null && val !== '' && !Number.isNaN(Number(val))) {
            const n = Number(val);
            return replaceFields ? n : (n > 0 ? n : prevVal);
          }
          return replaceFields ? 0 : prevVal;
        };

        return {
          ...prev,
          partyName: matched.partyName || matched.party_name || name,
          cultivatorName: pickText(matched.cultivatorName, matched.cultivator_name, prev.cultivatorName),
          locationName: pickText(matched.locationName, matched.location_name, prev.locationName),
          village: pickText(matched.village, undefined, prev.village),
          mobileNo: pickText(matched.mobileNo, matched.mobile_no, prev.mobileNo),
          product: pickText(matched.product, matched.material, prev.product),
          rate: pickNum(matched.rate, prev.rate),
          charges: pickNum(matched.charges, prev.charges),
          chessNo: pickText(matched.chessNo, matched.chess_no, prev.chessNo),
          chessName: pickText(matched.chessName, matched.chess_name, prev.chessName),
          chessAmount: pickNum(matched.chessAmount ?? matched.chess_amount, prev.chessAmount),
          bagsBales: pickText(matched.bagsBales, matched.bags_bales, prev.bagsBales),
          fatherName: pickText(matched.fatherName, matched.father_name, prev.fatherName),
          status: normalizeStatus(matched.status, prev.status || 'Inward'),
        };
      });
    };

    // 1. If a suggestion object was explicitly selected, apply it immediately
    let matched: any = isObjInput ? partyNameOrObj : null;

    // 2. Check in savedParties state
    if (!matched) {
      matched = savedParties.find(
        (p) => (p.partyName || p.party_name || '').trim().toLowerCase() === clean
      );
    }

    // 3. Check in sessions state
    if (!matched) {
      matched = sessions.find(
        (s) => (s.partyName || '').trim().toLowerCase() === clean
      );
    }

    if (matched) {
      applyMatchedProfile(matched, replaceFromSelection);
      return true;
    }

    // 4. Fallback: query API asynchronously (response shape is { success, party })
    api.getPartyDetails(name).then((res: any) => {
      const party = res?.party || (res?.partyName || res?.party_name ? res : null);
      if (party) {
        applyMatchedProfile(party, replaceFromSelection);
      }
    }).catch(() => {});

    return false;
  }, [savedParties, sessions]);

  // Form field updater helper
  const updateFormField = useCallback(<K extends keyof TerminalFormData>(field: K, value: TerminalFormData[K]) => {
    setFormData((prev) => {
      if (field === 'status') {
        const { dateStr, timeStr } = getCurrentDateTimeStamp();
        if (prev.firstWeight === null) {
          return {
            ...prev,
            status: String(value),
            firstWeightDate: prev.firstWeightDate || dateStr,
            firstWeightTime: prev.firstWeightTime || timeStr,
          };
        } else {
          return {
            ...prev,
            status: String(value),
            secondWeightDate: prev.secondWeightDate || dateStr,
            secondWeightTime: prev.secondWeightTime || timeStr,
          };
        }
      }
      return { ...prev, [field]: value };
    });
  }, [currentWeight.weight]);

  // Automated Commercial Calculations
  const calculations = useMemo(() => {
    const { firstWeight, secondWeight, rate, moisture, charges, chessAmount } = formData;
    
    // Nett Weight = |1st Weight - 2nd Weight|
    const nettWeight = (firstWeight !== null && secondWeight !== null)
      ? Math.abs(secondWeight - firstWeight)
      : (firstWeight !== null ? firstWeight : 0);

    // Moisture deduction in kg = nettWeight * (moisture / 100)
    const moistureDeductionKg = Math.round(nettWeight * ((moisture || 0) / 100));

    // Final Weight = Nett - Moisture Deduction
    const finalWeight = Math.max(0, Math.round(nettWeight - moistureDeductionKg));

    const finalRate = rate || 0;

    // Commercial calculation:
    // In cotton/quintal trade, if finalRate >= 500, rate is per Quintal (100 kg)
    // If finalRate < 500, rate is per kg
    let materialCost = 0;
    if (finalRate >= 500) {
      const weightInQtl = finalWeight / 100;
      materialCost = Math.round(weightInQtl * finalRate);
    } else {
      materialCost = Math.round(finalWeight * finalRate);
    }

    const totalAmount = materialCost + (charges || 0) + (chessAmount || 0);

    return {
      nettWeight,
      moistureDeductionKg,
      finalWeight,
      finalRate,
      totalAmount,
    };
  }, [formData]);

  // F1: New Transaction (Redirects to next unalloted sequence number, stays until weight is latched, clears all data)
  const handleNew = useCallback(async () => {
    // 1. Fetch highest alloted sequence number from database
    let dbNextTx = 1;
    try {
      const res = await api.getNextTransactionNo();
      if (res && res.nextTransactionNo) {
        dbNextTx = Number(res.nextTransactionNo);
      }
    } catch {
      dbNextTx = 1;
    }

    const currentHasWeight = formData.firstWeight !== null || formData.secondWeight !== null;

    // Filter local sessions/pending for actual recorded weights
    const localAllocated = [...sessions, ...pendingVehicles]
      .filter((s) => s.firstWeight !== null || s.tareWeight !== null || s.secondWeight !== null)
      .map((s) => Number(s.transactionNo) || 0)
      .filter((n) => n > 0);

    const maxRecordedAllocated = localAllocated.length > 0 ? Math.max(...localAllocated) : 0;

    // The highest allocated sequence number across DB, local memory, and currently latched form weight:
    const maxAllocatedTx = Math.max(
      dbNextTx - 1,
      maxRecordedAllocated,
      currentHasWeight ? (Number(formData.transactionNo) || 0) : 0
    );

    // The next available unalloted transaction sequence number (Rules 1-4)
    const unallotedTx = Math.max(1, maxAllocatedTx + 1);
    const targetTx = unallotedTx;

    setFormData({
      ...initialForm,
      printImages: company.weighbridgeDefaults?.printImages ?? true,
      transactionNo: targetTx,
      vehicleRegNo: '',
      partyName: '',
      product: '',
      status: '',
      locationName: '',
      cultivatorName: '',
      loadSlipNo: '',
      bagsBales: '',
      charges: 0,
      rate: 0,
      moisture: 0,
      chessNo: '',
      chessName: '',
      chessAmount: 0,
      village: '',
      mobileNo: '',
      firstWeight: null,
      firstWeightDate: '',
      firstWeightTime: null,
      secondWeight: null,
      secondWeightDate: '',
      secondWeightTime: null,
      fatherName: '',
      deduction: 0,
      vehicleType: '',
      agent: '',
    });

    setEvidenceList([]);
    setActiveSlip(null);
    setLoadedPendingTxNo(null);
    setF3FirstWeightTxNo(null);
    return targetTx;
  }, [formData.transactionNo, formData.firstWeight, formData.secondWeight, sessions, pendingVehicles]);

  // Safe Date Helpers for Weighbridge
  const toSafeIsoTimestamp = (dateVal?: string | null, timeVal?: string | null): string => {
    const now = new Date();
    if (!dateVal && !timeVal) return now.toISOString();
    try {
      let year = now.getFullYear();
      let month = now.getMonth();
      let day = now.getDate();
      let hour = now.getHours();
      let min = now.getMinutes();
      let sec = now.getSeconds();

      if (dateVal) {
        const dParts = dateVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (dParts) {
          day = parseInt(dParts[1], 10);
          month = parseInt(dParts[2], 10) - 1;
          year = parseInt(dParts[3], 10);
        } else {
          const isoParts = dateVal.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
          if (isoParts) {
            year = parseInt(isoParts[1], 10);
            month = parseInt(isoParts[2], 10) - 1;
            day = parseInt(isoParts[3], 10);
          }
        }
      }

      if (timeVal) {
        const tParts = timeVal.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
        if (tParts) {
          hour = parseInt(tParts[1], 10);
          min = parseInt(tParts[2], 10);
          sec = tParts[3] ? parseInt(tParts[3], 10) : 0;
        }
      }

      const d = new Date(year, month, day, hour, min, sec);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch (e) {}
    return now.toISOString();
  };

  const safeFormatDateString = (dateVal?: string | null, timeVal?: string | null): string => {
    if (dateVal && dateVal.trim() && dateVal !== '-') {
      return formatToDDMMYYYY(dateVal);
    }
    if (timeVal) {
      return formatToDDMMYYYY(timeVal);
    }
    const { dateStr } = getCurrentDateTimeStamp();
    return dateStr;
  };

  const safeFormatTimeString = (timeVal?: string | null): string => {
    if (!timeVal || timeVal === '-') return '';
    return formatToHHMMSS(timeVal);
  };

  // F3: Get Weight (Primary Action - Latches current scale weight & persists transaction while keeping screen active)
  const buildPayloadFromForm = useCallback((
    targetForm: TerminalFormData,
    overrideNettWeight?: number,
    overrideStatus?: string
  ): WeighbridgeSession => {
    const { dateStr, timeStr } = getCurrentDateTimeStamp();
    const effectiveSecondDate = targetForm.secondWeightDate || (targetForm.secondWeight !== null ? dateStr : '');
    const effectiveSecondTime = targetForm.secondWeightTime || (targetForm.secondWeight !== null ? timeStr : null);
    const effectiveSecondWeight = (targetForm.secondWeight !== null && targetForm.secondWeight !== undefined)
      ? targetForm.secondWeight
      : null;

    const isCompleted = targetForm.firstWeight !== null && effectiveSecondWeight !== null && Number(effectiveSecondWeight) > 0;
    const isOutward = (targetForm.status || '').toLowerCase().includes('outward');

    const calculatedNett = overrideNettWeight !== undefined
      ? overrideNettWeight
      : ((targetForm.firstWeight !== null && effectiveSecondWeight !== null)
        ? Math.abs(effectiveSecondWeight - targetForm.firstWeight)
        : calculations.nettWeight);

    const moistureDeductionKg = Math.round(calculatedNett * ((targetForm.moisture || 0) / 100));
    const finalWeight = Math.max(0, Math.round(calculatedNett - moistureDeductionKg));
    const finalRate = targetForm.rate || 0;
    const materialCost = finalRate >= 500
      ? Math.round((finalWeight / 100) * finalRate)
      : Math.round(finalWeight * finalRate);
    const totalAmount = materialCost + (targetForm.charges || 0) + (targetForm.chessAmount || 0);

    const printOptions: PrintOptions = {
      printDuplicate: targetForm.printDuplicate,
      printQrCode: targetForm.printQrCode,
      printImages: company.weighbridgeDefaults?.printImages ?? targetForm.printImages,
    };

    let tareWeight = null;
    let grossWeight = null;
    if (isOutward) {
      tareWeight = targetForm.firstWeight;
      grossWeight = effectiveSecondWeight;
    } else {
      grossWeight = targetForm.firstWeight;
      tareWeight = effectiveSecondWeight;
    }

    return {
      sessionId: `WB-TX-${targetForm.transactionNo}-${Date.now()}`,
      transactionNo: targetForm.transactionNo,
      vehicleRegNo: targetForm.vehicleRegNo || '',
      vehicleNo: targetForm.vehicleRegNo || '',
      partyName: targetForm.partyName || '',
      firmName: targetForm.firmName || company.firmName || 'DHARANI COTTON MILLS',
      companyName: company.firmName || company.companyName || targetForm.firmName || 'DHARANI COTTON MILLS',
      locationName: targetForm.locationName || '',
      cultivatorName: targetForm.cultivatorName || '',
      loadSlipNo: targetForm.loadSlipNo || '',
      bagsBales: targetForm.bagsBales || '',
      fatherName: targetForm.fatherName || '',
      mobileNo: targetForm.mobileNo || '',
      product: targetForm.product || '',
      material: targetForm.product || '',
      timestamp: new Date().toISOString(),
      firstWeight: targetForm.firstWeight,
      firstWeightTime: targetForm.firstWeight ? toSafeIsoTimestamp(targetForm.firstWeightDate, targetForm.firstWeightTime) : null,
      secondWeight: effectiveSecondWeight,
      secondWeightTime: effectiveSecondWeight ? toSafeIsoTimestamp(effectiveSecondDate, effectiveSecondTime) : null,
      tareWeight,
      grossWeight,
      netWeight: calculatedNett,
      nettWeight: calculatedNett,
      rate: targetForm.rate,
      moisture: targetForm.moisture,
      deduction: targetForm.deduction,
      charges: targetForm.charges,
      vehicleType: targetForm.vehicleType,
      agent: targetForm.agent,
      village: targetForm.village,
      chessNo: targetForm.chessNo,
      chessAmount: targetForm.chessAmount,
      chessName: targetForm.chessName,
      finalRate,
      totalAmount,
      printOptions,
      evidence: evidenceList,
      status: overrideStatus || (isCompleted ? 'completed' : (targetForm.status || (isOutward ? 'Outward' : 'Inward'))),
      operatorId: 'OP001',
      operatorName: 'Weighbridge Operator',
      adminName: 'System Admin',
    };
  }, [calculations.nettWeight, evidenceList, company]);

  const handleGetWeight = useCallback(async () => {
    const weightToLatch = currentWeight.weight;
    const { dateStr, timeStr } = getCurrentDateTimeStamp();

    const rawVeh = (formData.vehicleRegNo || '').trim().toUpperCase();
    const cleanVeh = rawVeh.replace(/[\s\-_]/g, '');

    // Check if this vehicle is currently loaded from pending vehicles for 2nd weight
    let pendingMatch: WeighbridgeSession | null = null;
    if (loadedPendingTxNo !== null) {
      pendingMatch = pendingVehicles.find((p) => Number(p.transactionNo) === Number(loadedPendingTxNo)) || null;
    } else if (cleanVeh) {
      pendingMatch = pendingVehicles.find((p) => (p.vehicleRegNo || '').replace(/[\s\-_]/g, '').toUpperCase() === cleanVeh && Number(p.transactionNo) === Number(formData.transactionNo)) || null;
    }

    const isFreshFirstWeightScreen = f3FirstWeightTxNo === formData.transactionNo && loadedPendingTxNo === null;
    const isSecondWeight =
      (loadedPendingTxNo !== null && loadedPendingTxNo === formData.transactionNo) ||
      (!isFreshFirstWeightScreen && pendingMatch !== null && Number(pendingMatch.transactionNo) === Number(formData.transactionNo) && (pendingMatch.firstWeight !== null || pendingMatch.tareWeight !== null || pendingMatch.grossWeight !== null)) ||
      (isFreshFirstWeightScreen && formData.firstWeight !== null && formData.firstWeight > 0 && weightToLatch > 0 && weightToLatch !== formData.firstWeight);

    const persistLatchedSession = async (targetForm: TerminalFormData, isSecond: boolean, resolvedNett: number) => {
      if (rawVeh.length < 3 || weightToLatch <= 0) {
        return { savedToDb: false, requiresVehicleNo: rawVeh.length < 3, errorMessage: '' };
      }
      if (isSecond && weightToLatch === (targetForm.firstWeight ?? 0)) {
        return {
          savedToDb: false,
          requiresVehicleNo: false,
          errorMessage: '2nd weight matches 1st weight (Nett Weight is 0 kg).',
        };
      }

      const payload = buildPayloadFromForm(
        targetForm,
        isSecond ? resolvedNett : undefined,
        isSecond ? 'completed' : (targetForm.status || 'Inward')
      );
      payload.vehicleRegNo = rawVeh;
      payload.vehicleNo = rawVeh;
      if (!isSecond) {
        payload.secondWeight = null;
        payload.secondWeightTime = null;
        payload.netWeight = null;
        payload.nettWeight = null;
      }

      try {
        await api.createWeighbridgeSession(payload);
        if (isSecond) {
          setLoadedPendingTxNo(null);
          setF3FirstWeightTxNo(null);
          setPendingVehicles((curr) => {
            const next = curr.filter((p) => p.transactionNo !== payload.transactionNo && (p.vehicleRegNo || '').toUpperCase() !== rawVeh);
            try { localStorage.setItem('rmc_pending_vehicles', JSON.stringify(next)); } catch (e) {}
            return next;
          });
          setSessions((curr) => [payload, ...curr.filter((s) => s.transactionNo !== payload.transactionNo)]);
        } else {
          setF3FirstWeightTxNo(Number(payload.transactionNo));
          setPendingVehicles((curr) => {
            const filtered = curr.filter((p) => p.transactionNo !== payload.transactionNo && (p.vehicleRegNo || '').toUpperCase() !== rawVeh);
            const next = [payload, ...filtered];
            try { localStorage.setItem('rmc_pending_vehicles', JSON.stringify(next)); } catch (e) {}
            return next;
          });
        }

        if (payload.partyName && payload.partyName.trim()) {
          setSavedParties((curr) => {
            const clean = payload.partyName.trim().toLowerCase();
            const filtered = curr.filter((p) => (p.partyName || p.party_name || '').trim().toLowerCase() !== clean);
            return [
              {
                partyName: payload.partyName.trim(),
                locationName: payload.locationName || '',
                cultivatorName: payload.cultivatorName || '',
                village: payload.village || '',
                mobileNo: payload.mobileNo || '',
                product: payload.product || payload.material || '',
                bagsBales: payload.bagsBales || '',
                rate: payload.rate || 0,
                chessName: payload.chessName || '',
                chessNo: payload.chessNo || '',
                chessAmount: payload.chessAmount || 0,
                charges: payload.charges || 0,
                status: payload.status || 'Inward',
              },
              ...filtered,
            ];
          });
        }

        await refreshTerminalData();
        return { savedToDb: true, requiresVehicleNo: false, errorMessage: '' };
      } catch (err: any) {
        console.error('Get Weight F3 DB save error:', err);
        return {
          savedToDb: false,
          requiresVehicleNo: false,
          errorMessage: err?.message || 'Unable to save weighment to database.',
        };
      }
    };

    if (isSecondWeight) {
      const resolved1stWeight = formData.firstWeight !== null
        ? formData.firstWeight
        : (pendingMatch?.firstWeight ?? pendingMatch?.tareWeight ?? pendingMatch?.grossWeight ?? 0);
      const resolved1stDate = formData.firstWeightDate || (pendingMatch as any)?.firstWeightDate || dateStr;
      const resolved1stTime = formData.firstWeightTime || pendingMatch?.firstWeightTime || timeStr;
      const currentStatus = (formData.status || pendingMatch?.status || 'Inward');
      const normalizedUiStatus = currentStatus.toLowerCase().includes('outward') ? 'Outward' : 'Inward';

      const updatedForm: TerminalFormData = {
        ...formData,
        vehicleRegNo: rawVeh || formData.vehicleRegNo,
        firstWeight: resolved1stWeight,
        firstWeightDate: resolved1stDate,
        firstWeightTime: resolved1stTime,
        secondWeight: weightToLatch,
        secondWeightDate: formData.secondWeightDate || dateStr,
        secondWeightTime: formData.secondWeightTime || timeStr,
        status: normalizedUiStatus,
      };

      const resolvedNett = Math.abs(weightToLatch - resolved1stWeight);
      setFormData(updatedForm);
      const saveResult = await persistLatchedSession(updatedForm, true, resolvedNett);
      return {
        isFirstWeight: false,
        weight: weightToLatch,
        nettWeight: resolvedNett,
        transactionNo: updatedForm.transactionNo,
        vehicleRegNo: rawVeh,
        ...saveResult,
      };
    }

    // 1st Weight Latch (Fresh vehicle)
    const updatedForm: TerminalFormData = {
      ...formData,
      vehicleRegNo: rawVeh || formData.vehicleRegNo,
      firstWeight: weightToLatch,
      firstWeightDate: dateStr,
      firstWeightTime: timeStr,
      secondWeight: null,
      secondWeightDate: '',
      secondWeightTime: null,
      status: formData.status || 'Inward',
    };
    setFormData(updatedForm);
    const saveResult = await persistLatchedSession(updatedForm, false, weightToLatch);

    return {
      isFirstWeight: true,
      weight: weightToLatch,
      nettWeight: weightToLatch,
      transactionNo: updatedForm.transactionNo,
      vehicleRegNo: rawVeh,
      ...saveResult,
    };
  }, [currentWeight.weight, loadedPendingTxNo, f3FirstWeightTxNo, pendingVehicles, formData, buildPayloadFromForm, refreshTerminalData]);

  // Save session payload to MySQL
  const buildSessionPayload = useCallback((): WeighbridgeSession => {
    return buildPayloadFromForm(formData, calculations.nettWeight);
  }, [buildPayloadFromForm, formData, calculations.nettWeight]);

  // F2: Save (without printing)
  const handleSave = useCallback(async () => {
    const rawVeh = (formData.vehicleRegNo || '').trim().toUpperCase();
    if (!rawVeh || rawVeh.length < 3) {
      toast({
        title: 'Vehicle Number Required',
        description: 'Please enter a valid Vehicle Registration Number (min 3 characters).',
        variant: 'destructive',
      });
      return null;
    }

    const { dateStr, timeStr } = getCurrentDateTimeStamp();
    const liveScale = currentWeight.weight > 0 ? currentWeight.weight : null;

    // Check if this vehicle is an existing pending vehicle returning for 2nd weight
    const isPendingVehicle = (loadedPendingTxNo !== null && loadedPendingTxNo === formData.transactionNo) ||
      (f3FirstWeightTxNo !== formData.transactionNo &&
        pendingVehicles.some((p) => Number(p.transactionNo) === Number(formData.transactionNo) && (p.firstWeight !== null || p.tareWeight !== null || p.grossWeight !== null)));

    // 2nd weight mode applies if it is a pending vehicle OR if 2nd weight has been explicitly entered > 0
    const isSecondWeightMode = isPendingVehicle || (formData.secondWeight !== null && Number(formData.secondWeight) > 0);
    
    let finalFirstWeight = formData.firstWeight !== null ? Number(formData.firstWeight) : null;
    let finalSecondWeight = formData.secondWeight !== null ? Number(formData.secondWeight) : null;

    if (!isSecondWeightMode) {
      // 1st Weight weighment for a new incoming vehicle
      if (finalFirstWeight === null || finalFirstWeight <= 0) {
        if (liveScale !== null && liveScale > 0) {
          finalFirstWeight = liveScale;
        } else {
          toast({
            title: 'Scale Weight Required',
            description: 'Please capture a scale weight from the live indicator or enter 1st weight.',
            variant: 'destructive',
          });
          return null;
        }
      }
      // Guarantee second weight is null for 1st weight weighments
      finalSecondWeight = null;
    } else {
      // 2nd Weight weighment for returning pending vehicle
      if (finalFirstWeight === null || finalFirstWeight <= 0) {
        const foundPending = pendingVehicles.find((p) => Number(p.transactionNo) === Number(formData.transactionNo));
        if (foundPending) {
          finalFirstWeight = Number(foundPending.firstWeight ?? foundPending.tareWeight ?? foundPending.grossWeight ?? 0);
        }
      }

      if (finalSecondWeight === null || finalSecondWeight <= 0) {
        if (liveScale !== null && liveScale > 0 && liveScale !== finalFirstWeight) {
          finalSecondWeight = liveScale;
        } else {
          toast({
            title: '2nd Weight Required',
            description: 'Please capture 2nd scale weight before saving.',
            variant: 'destructive',
          });
          return null;
        }
      }

      if (finalSecondWeight === finalFirstWeight) {
        toast({
          title: 'Identical Weights',
          description: '2nd weight cannot be identical to 1st weight (Net Weight is 0 kg).',
          variant: 'destructive',
        });
        return null;
      }
    }

    const resolvedFirstDate = formData.firstWeightDate || dateStr;
    const resolvedFirstTime = formData.firstWeightTime || timeStr;
    const resolvedSecondDate = formData.secondWeightDate || (finalSecondWeight !== null ? dateStr : '');
    const resolvedSecondTime = formData.secondWeightTime || (finalSecondWeight !== null ? timeStr : null);

    const isCompleted = finalFirstWeight !== null && finalFirstWeight > 0 && finalSecondWeight !== null && finalSecondWeight > 0;
    const isOutward = (formData.status || '').toLowerCase().includes('outward');
    const transactionStatus = isCompleted ? 'completed' : (formData.status || (isOutward ? 'Outward' : 'Inward'));

    // Update local form state
    setFormData((prev) => ({
      ...prev,
      vehicleRegNo: rawVeh,
      firstWeight: finalFirstWeight,
      firstWeightDate: resolvedFirstDate,
      firstWeightTime: resolvedFirstTime,
      secondWeight: finalSecondWeight,
      secondWeightDate: resolvedSecondDate,
      secondWeightTime: resolvedSecondTime,
      status: transactionStatus,
    }));

    const payload = buildSessionPayload();
    payload.vehicleRegNo = rawVeh;
    payload.vehicleNo = rawVeh;
    payload.firstWeight = finalFirstWeight;
    payload.firstWeightTime = toSafeIsoTimestamp(resolvedFirstDate, resolvedFirstTime);

    if (isOutward) {
      payload.tareWeight = finalFirstWeight;
      payload.grossWeight = finalSecondWeight;
    } else {
      payload.grossWeight = finalFirstWeight;
      payload.tareWeight = finalSecondWeight;
    }

    if (finalSecondWeight !== null) {
      payload.secondWeight = finalSecondWeight;
      payload.secondWeightTime = toSafeIsoTimestamp(resolvedSecondDate, resolvedSecondTime);
      payload.netWeight = Math.abs(finalSecondWeight - finalFirstWeight!);
      payload.nettWeight = Math.abs(finalSecondWeight - finalFirstWeight!);
    } else {
      payload.secondWeight = null;
      payload.secondWeightTime = null;
      payload.netWeight = null;
      payload.nettWeight = null;
    }

    payload.status = transactionStatus;

    try {
      await api.createWeighbridgeSession(payload);
      if (isCompleted) {
        // Remove completed vehicle from pending queue
        setLoadedPendingTxNo(null);
        setF3FirstWeightTxNo(null);
        setPendingVehicles((curr) => {
          const next = curr.filter((p) => p.transactionNo !== payload.transactionNo && (p.vehicleRegNo || '').toUpperCase() !== rawVeh);
          try { localStorage.setItem('rmc_pending_vehicles', JSON.stringify(next)); } catch (e) {}
          return next;
        });
        setSessions((curr) => [payload, ...curr.filter(s => s.transactionNo !== payload.transactionNo)]);
        toast({
          title: 'Record saved successfully',
          description: `Ticket #${payload.transactionNo} (${rawVeh}) weighment completed. Ready for A5 print.`,
        });

        // Launch A5 Weigh Slip Modal immediately
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const nowTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const fDate = safeFormatDateString(formData.firstWeightDate || (payload as any).firstWeightDate, payload.firstWeightTime);
        const fTime = safeFormatTimeString(formData.firstWeightTime || (payload as any).firstWeightTime || nowTimeStr);
        const sDate = safeFormatDateString(resolvedSecondDate || (payload as any).secondWeightDate, payload.secondWeightTime);
        const sTime = safeFormatTimeString(resolvedSecondTime || (payload as any).secondWeightTime || nowTimeStr);

        const companyAddressParts = [
          company.address || 'Industrial Zone, Highway Bypass, Vikarabad',
          company.city || 'Hyderabad',
          company.state ? `${company.state}${company.pincode ? ` - ${company.pincode}` : ''}` : 'Telangana - 500033'
        ].filter(Boolean);
        const resolvedCompanyAddress = companyAddressParts.join(', ');

        const slip: WeighSlip = {
          sessionId: payload.sessionId,
          slipNumber: `WS-${payload.transactionNo}`,
          transactionNo: payload.transactionNo,
          companyName: company.firmName || company.companyName || payload.firmName || formData.firmName || 'DHARANI COTTON MILLS',
          companyAddress: resolvedCompanyAddress,
          phoneNo: company.phone || '+91 20 2712 8899',
          partyName: payload.partyName || formData.partyName || '-',
          product: payload.product || payload.material || formData.product || 'Cotton',
          material: payload.product || payload.material || formData.product || 'Cotton',
          status: payload.status || 'Inward',
          locationName: payload.locationName || formData.locationName || '',
          cultivatorName: payload.cultivatorName || formData.cultivatorName || '',
          loadSlipNo: payload.loadSlipNo || formData.loadSlipNo || '',
          bagsBales: payload.bagsBales || formData.bagsBales || '',
          charges: payload.charges !== undefined ? payload.charges : (formData.charges || 0),
          rate: payload.rate !== undefined ? payload.rate : (formData.rate || 0),
          moisture: payload.moisture !== undefined ? payload.moisture : (formData.moisture || 0),
          chessNo: payload.chessNo || formData.chessNo || '',
          chessName: payload.chessName || formData.chessName || '',
          chessAmount: payload.chessAmount !== undefined ? payload.chessAmount : (formData.chessAmount || 0),
          village: payload.village || formData.village || '',
          mobileNo: payload.mobileNo || formData.mobileNo || '',
          vehicleNo: rawVeh,
          vehicleRegNo: rawVeh,
          firstWeight: finalFirstWeight || 0,
          firstWeightDate: fDate,
          firstWeightTime: fTime,
          secondWeight: finalSecondWeight || 0,
          secondWeightDate: sDate,
          secondWeightTime: sTime,
          nettWeight: payload.netWeight || 0,
          netWeight: payload.netWeight || 0,
          finalRate: payload.finalRate || calculations.finalRate,
          totalAmount: payload.totalAmount || calculations.totalAmount,
          adminName: 'System Admin',
          operatorName: 'Weighbridge Operator',
          firmName: payload.firmName || formData.firmName || 'DHARANI COTTON MILLS',
          dateTime: now.toISOString(),
          tareWeight: payload.tareWeight || 0,
          grossWeight: payload.grossWeight || 0,
          deduction: payload.deduction || formData.deduction,
          vehicleType: payload.vehicleType || formData.vehicleType,
          agent: payload.agent || formData.agent,
          printOptions: payload.printOptions,
          evidence: evidenceList,
        };

        setActiveSlip(slip);
        api.createWeighSlip(slip).catch((e) => console.warn('Weigh slip save to DB warning:', e));
      } else {
        // 1st weight recorded -> add to pending vehicles immediately
        setLoadedPendingTxNo(null);
        setF3FirstWeightTxNo(null);
        setPendingVehicles((curr) => {
          const filtered = curr.filter((p) => p.transactionNo !== payload.transactionNo && (p.vehicleRegNo || '').toUpperCase() !== rawVeh);
          const next = [payload, ...filtered];
          try { localStorage.setItem('rmc_pending_vehicles', JSON.stringify(next)); } catch (e) {}
          return next;
        });
        toast({
          title: 'Record saved successfully',
          description: `Ticket #${payload.transactionNo} (${rawVeh}) 1st weight recorded. Added to Pending queue.`,
        });

        // After saving 1st weight, advance to next transaction number and clear inputs
        handleNew();
      }

      if (payload.partyName && payload.partyName.trim()) {
        setSavedParties((curr) => {
          const clean = payload.partyName.trim().toLowerCase();
          const filtered = curr.filter((p) => (p.partyName || p.party_name || '').trim().toLowerCase() !== clean);
          return [
            {
              partyName: payload.partyName.trim(),
              locationName: payload.locationName || '',
              cultivatorName: payload.cultivatorName || '',
              village: payload.village || '',
              mobileNo: payload.mobileNo || '',
              product: payload.product || payload.material || '',
              bagsBales: payload.bagsBales || '',
              rate: payload.rate || 0,
              chessName: payload.chessName || '',
              chessNo: payload.chessNo || '',
              chessAmount: payload.chessAmount || 0,
              charges: payload.charges || 0,
              status: payload.status || 'Inward',
            },
            ...filtered,
          ];
        });
      }
      await refreshTerminalData();
      return payload;
    } catch (err) {
      console.error('Save session error:', err);
      return payload;
    }
  }, [buildSessionPayload, formData, currentWeight.weight, refreshTerminalData, handleNew, toast, company, evidenceList, calculations, loadedPendingTxNo, f3FirstWeightTxNo, pendingVehicles]);

  // F4: Save & Print (Commits session and shows weigh slip modal)
  const handleSaveAndPrint = useCallback(async () => {
    if (!formData.vehicleRegNo || !formData.vehicleRegNo.trim()) {
      toast({
        title: 'Vehicle Registration Required',
        description: 'Please enter a valid Vehicle Registration Number before printing.',
        variant: 'destructive',
      });
      return;
    }

    const session = await handleSave();
    if (!session) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const nowTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const fDate = safeFormatDateString(formData.firstWeightDate || (session as any).firstWeightDate, session.firstWeightTime);
    const fTime = safeFormatTimeString(formData.firstWeightTime || (session as any).firstWeightTime || nowTimeStr);
    const sDate = session.secondWeight ? safeFormatDateString(formData.secondWeightDate || (session as any).secondWeightDate, session.secondWeightTime) : '';
    const sTime = session.secondWeight ? safeFormatTimeString(formData.secondWeightTime || (session as any).secondWeightTime || nowTimeStr) : '';

    const companyAddressParts = [
      company.address || 'Vikarabad',
      company.city || 'Hyderabad',
      company.state ? `${company.state}${company.pincode ? ` - ${company.pincode}` : ''}` : 'Telangana - 500033'
    ].filter(Boolean);
    const resolvedCompanyAddress = companyAddressParts.join(', ');

    const slip: WeighSlip = {
      sessionId: session.sessionId,
      transactionNo: session.transactionNo,
      companyName: company.firmName || company.companyName || session.firmName || formData.firmName || 'DHARANI COTTON MILLS',
      companyAddress: resolvedCompanyAddress,
      phoneNo: company.phone || '+91 20 2712 8899',
      partyName: session.partyName || formData.partyName || '',
      product: session.product || formData.product || '',
      material: session.material || formData.product || '',
      status: formData.status || session.status || 'Inward',
      locationName: formData.locationName || session.locationName || '',
      cultivatorName: formData.cultivatorName || session.cultivatorName || '',
      loadSlipNo: formData.loadSlipNo || session.loadSlipNo || '',
      bagsBales: formData.bagsBales || session.bagsBales || '',
      charges: formData.charges !== undefined ? formData.charges : (session.charges || 0),
      rate: formData.rate !== undefined ? formData.rate : (session.rate || 0),
      moisture: formData.moisture !== undefined ? formData.moisture : (session.moisture || 0),
      chessNo: formData.chessNo || session.chessNo || '',
      chessName: formData.chessName || session.chessName || '',
      chessAmount: formData.chessAmount !== undefined ? formData.chessAmount : (session.chessAmount || 0),
      village: formData.village || session.village || '',
      mobileNo: formData.mobileNo || session.mobileNo || '',
      vehicleNo: session.vehicleRegNo || formData.vehicleRegNo || '',
      vehicleRegNo: session.vehicleRegNo || formData.vehicleRegNo || '',
      firstWeight: session.firstWeight || formData.firstWeight || 0,
      firstWeightDate: fDate,
      firstWeightTime: fTime,
      secondWeight: session.secondWeight || formData.secondWeight || 0,
      secondWeightDate: sDate,
      secondWeightTime: sTime,
      nettWeight: calculations.nettWeight,
      netWeight: calculations.nettWeight,
      finalRate: calculations.finalRate,
      totalAmount: calculations.totalAmount,
      adminName: session.operatorName || 'System Admin',
      operatorName: session.operatorName || 'System Admin',
      firmName: session.firmName || formData.firmName,
      dateTime: now.toISOString(),
      tareWeight: session.tareWeight || formData.firstWeight || 0,
      grossWeight: session.grossWeight || formData.secondWeight || 0,
      deduction: formData.deduction,
      vehicleType: formData.vehicleType,
      agent: formData.agent,
      printOptions: {
        ...session.printOptions,
        printImages: company.weighbridgeDefaults?.printImages ?? session.printOptions?.printImages ?? true,
      },
      driverName: session.driverName || 'Driver',
      destination: session.destination || formData.village || '',
      evidence: session.evidence,
    };

    setActiveSlip(slip);
    api.createWeighSlip(slip).catch((e) => console.warn('Weigh slip save to DB warning:', e));
    api.createWeighSlip(slip).catch((e) => console.warn('Weigh slip save to DB warning:', e));
  }, [handleSave, formData, calculations, company]);

  // F5: Print (Open slip modal for current transaction)
  const handlePrint = useCallback(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const nowTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const fDate = safeFormatDateString(formData.firstWeightDate, formData.firstWeightTime);
    const fTime = safeFormatTimeString(formData.firstWeightTime || nowTimeStr);
    const sDate = formData.secondWeight ? safeFormatDateString(formData.secondWeightDate, formData.secondWeightTime) : '';
    const sTime = formData.secondWeight ? safeFormatTimeString(formData.secondWeightTime || nowTimeStr) : '';

    const companyAddressParts = [
      company.address || 'Vikarabad',
      company.city || 'Hyderabad',
      company.state ? `${company.state}${company.pincode ? ` - ${company.pincode}` : ''}` : 'Telangana - 500033'
    ].filter(Boolean);
    const resolvedCompanyAddress = companyAddressParts.join(', ');

    const slip: WeighSlip = {
      sessionId: `WB-TX-${formData.transactionNo}`,
      transactionNo: formData.transactionNo,
      companyName: company.firmName || company.companyName || formData.firmName || 'DHARANI COTTON MILLS',
      companyAddress: resolvedCompanyAddress,
      phoneNo: company.phone || '+91 20 2712 8899',
      partyName: formData.partyName || '',
      product: formData.product || '',
      material: formData.product || '',
      status: formData.status || 'Inward',
      locationName: formData.locationName || '',
      cultivatorName: formData.cultivatorName || '',
      loadSlipNo: formData.loadSlipNo || '',
      bagsBales: formData.bagsBales || '',
      charges: formData.charges !== undefined ? formData.charges : 0,
      rate: formData.rate !== undefined ? formData.rate : 0,
      moisture: formData.moisture !== undefined ? formData.moisture : 0,
      chessNo: formData.chessNo || '',
      chessName: formData.chessName || '',
      chessAmount: formData.chessAmount !== undefined ? formData.chessAmount : 0,
      village: formData.village || '',
      mobileNo: formData.mobileNo || '',
      vehicleNo: formData.vehicleRegNo || '',
      vehicleRegNo: formData.vehicleRegNo || '',
      firstWeight: formData.firstWeight || 0,
      firstWeightDate: fDate,
      firstWeightTime: formData.firstWeightTime,
      secondWeight: formData.secondWeight || 0,
      secondWeightDate: sDate,
      secondWeightTime: formData.secondWeightTime,
      nettWeight: calculations.nettWeight,
      netWeight: calculations.nettWeight,
      finalRate: calculations.finalRate,
      totalAmount: calculations.totalAmount,
      adminName: 'System Admin',
      operatorName: 'System Admin',
      firmName: formData.firmName,
      dateTime: now.toISOString(),
      tareWeight: formData.firstWeight || 0,
      grossWeight: formData.secondWeight || 0,
      deduction: formData.deduction,
      vehicleType: formData.vehicleType,
      agent: formData.agent,
      printOptions: {
        printDuplicate: formData.printDuplicate,
        printQrCode: formData.printQrCode,
        printImages: company.weighbridgeDefaults?.printImages ?? formData.printImages,
      },
      driverName: 'Driver',
      destination: formData.village || '',
      evidence: evidenceList,
    };
    setActiveSlip(slip);
    api.createWeighSlip(slip).catch((e) => console.warn('Weigh slip save to DB warning:', e));
  }, [formData, calculations, evidenceList, company]);

  // F7: Close / Clear
  const handleClose = useCallback(() => {
    setFormData((prev) => ({
      ...initialForm,
      printImages: company.weighbridgeDefaults?.printImages ?? true,
      transactionNo: prev.transactionNo,
    }));
    setActiveSlip(null);
    setLoadedPendingTxNo(null);
    setF3FirstWeightTxNo(null);
  }, [company.weighbridgeDefaults?.printImages]);

  // Transaction Navigation (◀ [ txNo ] ▶)
  const navigateTransaction = useCallback((dir: 'prev' | 'next') => {
    setFormData((prev) => {
      const validTxs = [...sessions, ...pendingVehicles]
        .map((s) => Number(s.transactionNo) || 0)
        .filter((n) => n > 0 && n < 100);
      const maxRecordedTx = validTxs.length > 0 ? Math.max(...validTxs) : 0;
      const maxAllowed = Math.max(1, maxRecordedTx + 1);
      const newTx = dir === 'prev' ? Math.max(1, prev.transactionNo - 1) : Math.min(maxAllowed, prev.transactionNo + 1);
      const found = sessions.find((s) => s.transactionNo === newTx) || pendingVehicles.find((p) => p.transactionNo === newTx);
      if (found) {
        return {
          ...initialForm,
          transactionNo: newTx,
          vehicleRegNo: found.vehicleRegNo || '',
          partyName: found.partyName || '',
          product: found.product || found.material || '',
          status: found.status || '',
          firmName: found.firmName || '',
          locationName: (found as any).locationName || '',
          cultivatorName: (found as any).cultivatorName || '',
          loadSlipNo: (found as any).loadSlipNo || '',
          rate: found.rate || 0,
          moisture: found.moisture || 0,
          deduction: found.deduction || 0,
          charges: found.charges || 0,
          vehicleType: found.vehicleType || '',
          bagsBales: (found as any).bagsBales || '',
          agent: found.agent || '',
          village: (found as any).village || '',
          chessNo: (found as any).chessNo || '',
          chessAmount: (found as any).chessAmount || 0,
          chessName: (found as any).chessName || '',
          mobileNo: (found as any).mobileNo || '',
          firstWeight: found.firstWeight ?? null,
          firstWeightDate: found.firstWeight !== null && found.firstWeight !== undefined ? formatToDDMMYYYY((found as any).firstWeightDate || (found as any).first_weight_date || found.firstWeightTime || (found as any).timestamp) : '',
          firstWeightTime: found.firstWeight !== null && found.firstWeight !== undefined ? formatToHHMMSS(found.firstWeightTime || (found as any).timestamp) : null,
          secondWeight: found.secondWeight ?? null,
          secondWeightDate: (found.secondWeight !== null && found.secondWeight !== undefined) ? formatToDDMMYYYY((found as any).secondWeightDate || (found as any).second_weight_date || found.secondWeightTime) : '',
          secondWeightTime: (found.secondWeight !== null && found.secondWeight !== undefined) ? formatToHHMMSS(found.secondWeightTime) : null,
        };
      }
      return {
        ...initialForm,
        transactionNo: newTx,
      };
    });
  }, [sessions, pendingVehicles]);

  // Search and fetch transaction from pending vehicles, sessions, or backend
  const searchAndLoadTransaction = useCallback(async (txNo: number | string) => {
    const num = Number(txNo);
    if (!num || isNaN(num) || num <= 0) {
      return { found: false, source: 'none' as const, message: 'Please enter a valid Transaction Number' };
    }

    // 1. Search in Pending Vehicles first
    const pendingMatch = pendingVehicles.find((p) => Number(p.transactionNo) === num);
    if (pendingMatch) {
      loadPendingVehicle(pendingMatch);
      const vehStatus = (pendingMatch.status || 'Inward').toLowerCase().includes('outward') ? 'Outward' : 'Inward';
      return {
        found: true,
        source: 'pending' as const,
        data: pendingMatch,
        message: `Ticket #${num} (${pendingMatch.vehicleRegNo}) loaded for ${vehStatus} 2nd weight`,
      };
    }

    // 2. Search in local sessions list
    const sessionMatch = sessions.find((s) => Number(s.transactionNo) === num);
    if (sessionMatch) {
      const isPending = (sessionMatch.secondWeight === null || Number(sessionMatch.secondWeight) === 0) &&
                        (sessionMatch.firstWeight !== null && Number(sessionMatch.firstWeight) > 0) &&
                        sessionMatch.status !== 'completed' && sessionMatch.status !== 'Completed';
      if (isPending) {
        loadPendingVehicle(sessionMatch);
        const vehStatus = (sessionMatch.status || 'Inward').toLowerCase().includes('outward') ? 'Outward' : 'Inward';
        return {
          found: true,
          source: 'pending' as const,
          data: sessionMatch,
          message: `Ticket #${num} (${sessionMatch.vehicleRegNo}) loaded for ${vehStatus} 2nd weight`,
        };
      } else {
        loadFullSession(sessionMatch);
        return {
          found: true,
          source: 'sessions' as const,
          data: sessionMatch,
          message: `Ticket #${num} (${sessionMatch.vehicleRegNo}) loaded`,
        };
      }
    }

    // 3. Search via Backend API
    try {
      const fetched = await api.getWeighbridgeSession(String(num));
      if (fetched && (fetched.transactionNo || fetched.sessionId)) {
        const isPending = (fetched.secondWeight === null || Number(fetched.secondWeight) === 0) &&
                          (fetched.firstWeight !== null && Number(fetched.firstWeight) > 0) &&
                          fetched.status !== 'completed' && fetched.status !== 'Completed';
        if (isPending) {
          loadPendingVehicle(fetched);
          const vehStatus = (fetched.status || 'Inward').toLowerCase().includes('outward') ? 'Outward' : 'Inward';
          return {
            found: true,
            source: 'pending' as const,
            data: fetched,
            message: `Ticket #${num} (${fetched.vehicleRegNo}) loaded for ${vehStatus} 2nd weight`,
          };
        } else {
          loadFullSession(fetched);
          return {
            found: true,
            source: 'database' as const,
            data: fetched,
            message: `Ticket #${num} (${fetched.vehicleRegNo}) loaded`,
          };
        }
      }
    } catch (e) {
      // not found
    }

    return {
      found: false,
      source: 'none' as const,
      message: `Ticket #${num} was not found in pending vehicles or past records.`,
    };
  }, [pendingVehicles, sessions, loadPendingVehicle, loadFullSession]);

  // Snapshot Capture Trigger (fallback)
  const takeSnapshot = useCallback((angle: 'front' | 'side' | 'rear') => {
    const urls: Record<string, string> = {
      front: '/snapshots/wb-tx' + (formData.transactionNo || 1) + '-cam1.jpg',
      side: '/snapshots/wb-tx' + (formData.transactionNo || 1) + '-cam2.jpg',
      rear: '/snapshots/wb-tx' + (formData.transactionNo || 1) + '-cam3.jpg',
    };

    const newEvidence: Evidence = {
      id: `ev-${Date.now()}`,
      type: 'image',
      url: urls[angle] || urls.front,
      angle,
      timestamp: new Date().toISOString(),
    };

    setEvidenceList((prev) => [newEvidence, ...prev.slice(0, 2)]);
  }, [formData.transactionNo]);

  const addEvidenceItems = useCallback((items: Evidence[]) => {
    setEvidenceList((prev) => {
      const combined = [...items, ...prev];
      const unique = combined.filter((v, i, a) => a.findIndex(t => t.id === v.id || t.url === v.url) === i);
      return unique.slice(0, 6);
    });
  }, []);

  return {
    currentWeight,
    formData,
    setFormData,
    calculations,
    evidenceList,
    setEvidenceList,
    addEvidenceItems,
    sessions,
    pendingVehicles,
    activeSlip,
    isLoading,
    setActiveSlip,
    updateFormField,
    handleNew,
    handleGetWeight,
    handleSave,
    handleSaveAndPrint,
    handlePrint,
    handleClose,
    navigateTransaction,
    loadPendingVehicle,
    loadFullSession,
    linkVehicleIfPending,
    searchAndLoadTransaction,
    takeSnapshot,
    refreshTerminalData,
    setCurrentWeight,
    setManualWeight,
    clearManualWeight,
    isManualOverride: isManualOverrideRef.current,
    zeroScale,
    savedParties,
    setSavedParties,
    applyPartyDetails,
    latestGateVehicle,
    recentGateVehicles,
    autoSyncGateVehicle,
    setAutoSyncGateVehicle: handleSetAutoSync,
    fetchAndApplyGateVehicle,
    applyGateVehicle,
  };
};
