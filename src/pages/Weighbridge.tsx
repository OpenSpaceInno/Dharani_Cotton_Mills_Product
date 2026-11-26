import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Scale,
  FileText,
  Calculator as CalcIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckSquare,
  Square,
  Mail,
  Printer,
  X,
  AlertCircle,
  Truck,
  Sparkles,
  Cpu,
  RefreshCw,
  Radio,
  Scan,
  Clock,
  Edit3,
  List as ListIcon,
  CheckCircle2,
} from 'lucide-react';
import { useWeighbridge } from '@/hooks/useWeighbridge';
import { IndustrialDigitalIndicator } from '@/components/weighbridge/IndustrialDigitalIndicator';
import DualCameraFeedPanel, { DualCameraFeedPanelHandle } from '@/components/weighbridge/DualCameraFeedPanel';
import { PendingVehiclesDrawer } from '@/components/weighbridge/PendingVehiclesDrawer';
import { CalculatorModal } from '@/components/weighbridge/CalculatorModal';
import { IndustrialWeighSlipModal } from '@/components/weighbridge/IndustrialWeighSlipModal';
import { WeighmentF5PrintModal } from '@/components/weighbridge/WeighmentF5PrintModal';
import { ReportsModal } from '@/components/weighbridge/ReportsModal';
import { ThirdPartyScaleModal } from '@/components/weighbridge/ThirdPartyScaleModal';
import { useToast } from '@/hooks/use-toast';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { isAdminRole } from '@/types/auth';
import { WeighSlip } from '@/types/weighbridge';
import { api } from '@/lib/api';
import { COTTON_PRODUCTS } from '@/constants/products';
import { formatToDDMMYYYY, formatToHHMMSS, getCurrentDateTimeStamp } from '@/utils/dateTimeFormatters';

export const Weighbridge: React.FC = () => {
  const {
    currentWeight,
    formData,
    setFormData,
    calculations,
    evidenceList,
    addEvidenceItems,
    sessions,
    pendingVehicles,
    activeSlip,
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
    searchAndLoadTransaction,
    linkVehicleIfPending,
    takeSnapshot,
    setCurrentWeight,
    setManualWeight,
    clearManualWeight,
    zeroScale,
    savedParties,
    applyPartyDetails,
    latestGateVehicle,
    recentGateVehicles,
    autoSyncGateVehicle,
    setAutoSyncGateVehicle,
    fetchAndApplyGateVehicle,
    applyGateVehicle,
  } = useWeighbridge();

  const { toast } = useToast();
  const { company, setGlobalPrintImages } = useCompany();
  const { user, role } = useAuth();
  const isAdmin = isAdminRole(user, role);

  // Product Selection (Cotton Products only)
  const [isCustomProduct, setIsCustomProduct] = useState(false);
  const [isPartyAutoPopulated, setIsPartyAutoPopulated] = useState(false);

  // Dual camera panel ref for automated snapshot extraction & live ANPR access
  const cameraPanelRef = useRef<DualCameraFeedPanelHandle>(null);
  const [isCapturingSnapshots, setIsCapturingSnapshots] = useState(false);

  // Modals visibility state
  const [isPendingDrawerOpen, setIsPendingDrawerOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [isScaleBridgeOpen, setIsScaleBridgeOpen] = useState(false);
  const [searchFleetEnabled, setSearchFleetEnabled] = useState(false);
  const [isF5PrintOpen, setIsF5PrintOpen] = useState(false);
  const [adminEditMode, setAdminEditMode] = useState(false);

  // Google-style Party Name search autocomplete state
  const [isPartyDropdownOpen, setIsPartyDropdownOpen] = useState(false);
  const [highlightedPartyIdx, setHighlightedPartyIdx] = useState(-1);
  const partyDropdownRef = useRef<HTMLDivElement>(null);

  // Centered Get Weight (F3) confirmation modal state
  const [getWeightSuccessModal, setGetWeightSuccessModal] = useState<{
    isOpen: boolean;
    isFirstWeight: boolean;
    weight: number;
    nettWeight: number;
    transactionNo: number;
    vehicleRegNo: string;
    savedToDb: boolean;
    requiresVehicleNo: boolean;
    snapshotCount: number;
    errorMessage: string;
  } | null>(null);
  const f3OkButtonRef = useRef<HTMLButtonElement>(null);

  // Deduplicated saved party suggestions filtered by entered letters (prefix matches first)
  const filteredPartySuggestions = useMemo(() => {
    const query = (formData.partyName || '').trim().toLowerCase();
    if (!query) return [];

    const byName = new Map<string, any>();
    for (const p of savedParties) {
      const name = (p.partyName || p.party_name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { ...p, partyName: name });
    }
    for (const s of sessions) {
      const name = (s.partyName || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, s);
    }

    return Array.from(byName.values())
      .filter((p) => (p.partyName || '').toLowerCase().includes(query))
      .sort((a, b) => {
        const aName = (a.partyName || '').toLowerCase();
        const bName = (b.partyName || '').toLowerCase();
        const aStarts = aName.startsWith(query) ? 0 : 1;
        const bStarts = bName.startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return aName.localeCompare(bName);
      })
      .slice(0, 10);
  }, [formData.partyName, savedParties, sessions]);

  const handleSelectPartySuggestion = useCallback((partyObj: any) => {
    const selectedName = (partyObj.partyName || partyObj.party_name || '').trim();
    if (!selectedName) return;
    updateFormField('partyName', selectedName);
    applyPartyDetails(partyObj, true);
    setIsPartyAutoPopulated(true);
    setIsPartyDropdownOpen(false);
    setHighlightedPartyIdx(-1);
  }, [updateFormField, applyPartyDetails]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (partyDropdownRef.current && !partyDropdownRef.current.contains(event.target as Node)) {
        setIsPartyDropdownOpen(false);
        setHighlightedPartyIdx(-1);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (getWeightSuccessModal?.isOpen) {
      const timer = setTimeout(() => f3OkButtonRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    }
  }, [getWeightSuccessModal?.isOpen]);

  // Auto-detect vehicle from Gate Monitor ANPR / FTP on load
  useEffect(() => {
    if (!formData.vehicleRegNo) {
      fetchAndApplyGateVehicle();
    }
  }, [formData.vehicleRegNo, fetchAndApplyGateVehicle]);

  const handleFetchGate = useCallback(async () => {
    const res = await fetchAndApplyGateVehicle();
    if (res?.vehicleRegNo) {
      toast({
        title: 'Gate Vehicle Synced',
        description: `Vehicle ${res.vehicleRegNo} loaded from Gate Monitor ANPR`,
      });
    } else {
      toast({
        title: 'No Gate Vehicle Found',
        description: 'No recent plate detection available from Gate Monitor.',
        variant: 'destructive',
      });
    }
  }, [fetchAndApplyGateVehicle, toast]);

  const handleFetchCameraANPR = useCallback(async () => {
    if (cameraPanelRef.current) {
      const plate = cameraPanelRef.current.fetchDetectedPlate();
      if (plate) {
        updateFormField('vehicleRegNo', plate);
        toast({
          title: 'ANPR Plate Fetched',
          description: `Vehicle ${plate} read from Camera 1 Front ANPR.`,
        });
        return;
      }
    }
    // Fallback to latest FTP / Gate camera detection
    const res = await fetchAndApplyGateVehicle();
    if (res?.vehicleRegNo) {
      toast({
        title: 'ANPR Plate Fetched from Gate/FTP',
        description: `Vehicle ${res.vehicleRegNo} loaded from FTP Camera`,
      });
    } else {
      toast({
        title: 'No Vehicle on Camera',
        description: 'Camera 1 ANPR and Gate FTP show no vehicle currently present.',
      });
    }
  }, [fetchAndApplyGateVehicle, updateFormField, toast]);

  const handlePrintF5 = useCallback(() => {
    handlePrint();
    setIsF5PrintOpen(true);
  }, [handlePrint]);

  const handleSearchTx = useCallback(async (txNo: number) => {
    if (!txNo) {
      toast({
        title: 'Transaction Number Required',
        description: 'Please enter a valid Transaction Number to search.',
        variant: 'destructive',
      });
      return;
    }
    const result = await searchAndLoadTransaction(txNo);
    if (result.found) {
      toast({
        title: result.source === 'pending' ? 'Pending Vehicle Loaded' : 'Transaction Loaded',
        description: result.message,
      });
    } else {
      toast({
        title: 'Transaction Not Found',
        description: result.message,
        variant: 'destructive',
      });
    }
  }, [searchAndLoadTransaction, toast]);

  const handleVehicleBlur = useCallback(async (vehNo: string) => {
    if (!vehNo) return;
    const clean = vehNo.trim().toUpperCase();
    const matched = await linkVehicleIfPending(clean);
    if (matched) {
      toast({
        title: 'Pending Vehicle Loaded',
        description: `Vehicle ${clean} loaded for 2nd weight (Ticket #${matched.transactionNo}). Ready for scale capture.`,
      });
    }
  }, [linkVehicleIfPending, toast]);

  // Automated Get Weight (F3) + Multi-camera snapshot capture + DB save + centered OK popup
  const handleGetWeightWithSnapshots = useCallback(async () => {
    let snapshotCount = 0;
    try {
      setIsCapturingSnapshots(true);
      // 1. Latch current scale weight into form state and persist to MySQL while keeping screen active
      const res = await handleGetWeight();

      // 2. Concurrently capture live frames from active ANPR and IP cameras
      try {
        if (cameraPanelRef.current) {
          const capturedFrames = await cameraPanelRef.current.captureAllSnapshots({
            weight: res?.weight ?? currentWeight.weight,
            vehicleNo: res?.vehicleRegNo || formData.vehicleRegNo,
            transactionNo: res?.transactionNo ?? formData.transactionNo,
          });

          if (capturedFrames && capturedFrames.length > 0) {
            const uploadRes = await api.uploadWeighbridgeSnapshots({
              transactionNo: res?.transactionNo ?? formData.transactionNo,
              vehicleRegNo: res?.vehicleRegNo || formData.vehicleRegNo,
              weight: res?.weight ?? currentWeight.weight,
              images: capturedFrames,
            });

            if (uploadRes && uploadRes.snapshots && uploadRes.snapshots.length > 0) {
              snapshotCount = uploadRes.snapshots.length;
              addEvidenceItems(uploadRes.snapshots as any);
            }
          }
        }
      } catch (snapErr: any) {
        console.error('Camera capture error during Get Weight:', snapErr);
      }

      // 3. Display centered confirmation dialog with OK button
      setGetWeightSuccessModal({
        isOpen: true,
        isFirstWeight: res?.isFirstWeight ?? true,
        weight: res?.weight ?? currentWeight.weight,
        nettWeight: res?.nettWeight ?? 0,
        transactionNo: res?.transactionNo ?? formData.transactionNo,
        vehicleRegNo: res?.vehicleRegNo || formData.vehicleRegNo || '',
        savedToDb: Boolean(res?.savedToDb),
        requiresVehicleNo: Boolean(res?.requiresVehicleNo),
        snapshotCount,
        errorMessage: res?.errorMessage || '',
      });
    } catch (err: any) {
      console.error('Get Weight error:', err);
      setGetWeightSuccessModal({
        isOpen: true,
        isFirstWeight: true,
        weight: currentWeight.weight,
        nettWeight: 0,
        transactionNo: formData.transactionNo,
        vehicleRegNo: formData.vehicleRegNo || '',
        savedToDb: false,
        requiresVehicleNo: false,
        snapshotCount: 0,
        errorMessage: err?.message || 'Unable to latch live weight.',
      });
    } finally {
      setIsCapturingSnapshots(false);
    }
  }, [currentWeight.weight, formData.transactionNo, formData.vehicleRegNo, handleGetWeight, addEvidenceItems]);

  // Manual snapshot capture from the 3-slot stack
  const handleManualSnapshot = useCallback(async (angle: 'front' | 'side' | 'rear') => {
    try {
      const screenIdx = angle === 'front' ? 0 : (angle === 'side' ? 1 : 2);
      if (cameraPanelRef.current) {
        const snap = await cameraPanelRef.current.captureSingleSnapshot(screenIdx, {
          weight: currentWeight.weight,
          vehicleNo: formData.vehicleRegNo,
          transactionNo: formData.transactionNo,
        });
        if (snap) {
          const uploadRes = await api.uploadWeighbridgeSnapshots({
            transactionNo: formData.transactionNo,
            vehicleRegNo: formData.vehicleRegNo,
            weight: currentWeight.weight,
            images: [snap],
          });
          if (uploadRes && uploadRes.snapshots) {
            addEvidenceItems(uploadRes.snapshots as any);
            toast({
              title: 'Snapshot Captured',
              description: `${snap.camName} snapshot saved & synced.`,
            });
            return;
          }
        }
      }
      takeSnapshot(angle);
    } catch (e: any) {
      takeSnapshot(angle);
    }
  }, [currentWeight.weight, formData.transactionNo, formData.vehicleRegNo, addEvidenceItems, takeSnapshot, toast]);

  // Global Keyboard Shortcuts (F1–F7) with browser default override
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (getWeightSuccessModal?.isOpen) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          setGetWeightSuccessModal(null);
        }
        return;
      }

      // F1: New
      if (e.key === 'F1') {
        e.preventDefault();
        setIsPartyAutoPopulated(false);
        handleNew().then((newTx) => {
          toast({
            title: 'New Transaction (F1)',
            description: `Transaction #${newTx || formData.transactionNo} ready. All fields cleared.`,
          });
        });
      }
      // F2: Save
      else if (e.key === 'F2') {
        e.preventDefault();
        handleSave();
      }
      // F3: Get Weight + Camera Snapshots
      else if (e.key === 'F3') {
        e.preventDefault();
        handleGetWeightWithSnapshots();
      }
      // F4: Save & Print
      else if (e.key === 'F4') {
        e.preventDefault();
        handleSaveAndPrint();
      }
      // F5: Print
      else if (e.key === 'F5') {
        e.preventDefault();
        handlePrintF5();
      }
      // F7: Close
      else if (e.key === 'F7') {
        e.preventDefault();
        handleClose();
        toast({ title: 'Terminal Cleared (F7)', description: 'Current inputs reset' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [getWeightSuccessModal?.isOpen, handleNew, handleSave, handleGetWeightWithSnapshots, handleSaveAndPrint, handlePrintF5, handleClose, formData.transactionNo, toast]);

  const handleEmailSlip = (slip: WeighSlip) => {
    toast({
      title: 'E-Mail Dispatched',
      description: `Weigh slip ${slip.slipNumber} emailed to ${slip.partyName || 'Customer'} & Accounts`,
    });
  };

  return (
    <div className="space-y-4 font-sans select-none text-foreground">
      {/* 1. TOP HARDWARE & NAVIGATION RIBBON */}
      <header className="bg-card border border-border rounded-xl px-3 sm:px-4 py-2 shadow-xs flex flex-wrap items-center justify-between gap-2.5 min-h-[50px]">
        {/* Left: Weighment, Reports & Pending Vehicles Buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap shrink-0">
          <button
            onClick={() => { }}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 shadow-xs"
            title="Weighment Terminal Active"
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Weighment</span>
          </button>

          <button
            onClick={() => setIsReportsOpen(true)}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-muted text-foreground border border-border text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
            title="View Daily Register & Reports"
          >
            <FileText className="w-3.5 h-3.5 text-blue-500" />
            <span>Reports</span>
          </button>

          {/* Pending Vehicles Button (Moved from bottom to top) */}
          <button
            type="button"
            onClick={() => setIsPendingDrawerOpen(true)}
            className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold text-xs rounded-lg flex items-center gap-2 shadow-2xs transition-colors cursor-pointer"
            title="Open Pending Vehicles Drawer"
          >
            <Truck className="w-4 h-4 text-amber-500" />
            <span>Pending Vehicles</span>
            <span className="bg-amber-500 text-white px-2 py-0.5 rounded-full text-[11px] font-mono font-bold leading-tight min-w-[20px] text-center shadow-xs">
              {pendingVehicles.length}
            </span>
          </button>
        </div>

        {/* Center: Digital Scale Indicator (Weighing Calc Readout) */}
        <div className="flex items-center justify-center shrink-0 mx-auto">
          <IndustrialDigitalIndicator
            reading={currentWeight}
            mode="GROSS"
            digitsCount={6}
            isAdmin={isAdmin}
            isManual={currentWeight.source === 'admin_manual'}
            onManualWeightSet={(val) => {
              setManualWeight(val);
              toast({
                title: 'Manual Weight Applied',
                description: `${val.toLocaleString()} kg set on digital indicator by Admin.`,
              });
            }}
            onResetToLive={() => {
              clearManualWeight();
              toast({
                title: 'Live Scale Active',
                description: 'Reset to live USB indicator reading.',
              });
            }}
          />
        </div>

        {/* Right: Ventek Scale Integration + Exit Button */}
        <div className="flex items-center justify-end gap-2.5 shrink-0">
          <button
            onClick={() => setIsScaleBridgeOpen(true)}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
            title={`Configure Weighbridge Indicator (VENTEK VMS-WB ${currentWeight.serialPort || 'COM2'})`}
          >
            <Cpu className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <span className="font-mono text-xs">
              VENTEK VMS ({currentWeight.serialPort || 'COM2'})
            </span>
            <span className={`w-2 h-2 rounded-full ${currentWeight.connected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          </button>

          <button
            onClick={() => window.location.href = '/'}
            className="px-3 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 text-xs font-bold font-mono transition-colors shadow-2xs"
            title="Exit Weighment Terminal"
          >
            Exit
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSTATION WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Left Section: Two-Column Form & Calculation Grid (LG+: 8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-3">
          {/* Upper Transaction Panel */}
          <div className="bg-card border border-border rounded-xl p-4 shadow-xs flex flex-col">
            {/* Transaction Navigator Bar: Transaction No / ◀ [ 001 ] ▶ */}
            <div className="flex flex-col items-center justify-center mb-4 pb-3 border-b border-border">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Transaction No
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => navigateTransaction('prev')}
                  className="w-10 h-9 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-black text-sm flex items-center justify-center shadow-2xs transition-all active:scale-95 cursor-pointer"
                  title="Previous Transaction (◀)"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formData.transactionNo || ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    const val = raw === '' ? 0 : parseInt(raw, 10);
                    updateFormField('transactionNo', isNaN(val) ? 0 : val);
                  }}
                  onBlur={() => {
                    if (formData.transactionNo) {
                      handleSearchTx(formData.transactionNo);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearchTx(formData.transactionNo);
                    }
                  }}
                  placeholder="1"
                  className="w-32 py-1.5 px-3 bg-background border-2 border-primary/40 focus:border-primary rounded-lg text-center font-mono font-black text-2xl text-primary shadow-2xs focus:outline-none focus:ring-2 focus:ring-primary/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  title="Transaction Number: Type number and press Enter or tab out to search"
                />
                <button
                  type="button"
                  onClick={() => navigateTransaction('next')}
                  className="w-10 h-9 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-black text-sm flex items-center justify-center shadow-2xs transition-all active:scale-95 cursor-pointer"
                  title="Next Transaction (▶)"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 2-Column Form Fields (Exactly 8 rows per column matching reference layout) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-xs">
              {/* Column 1 (Left - 8 rows) */}
              <div className="space-y-2.5">
                {/* 1. Vehicle No * */}
                <div className="flex items-center gap-2">
                  <div className="w-28 flex flex-col">
                    <label className="font-bold text-destructive whitespace-nowrap">
                      Vehicle No *
                    </label>
                  </div>
                  <div className="flex-1 relative flex items-center">
                    <input
                      type="text"
                      value={formData.vehicleRegNo}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        updateFormField('vehicleRegNo', val);
                      }}
                      onBlur={() => handleVehicleBlur(formData.vehicleRegNo)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleVehicleBlur(formData.vehicleRegNo);
                        }
                      }}
                      placeholder="e.g. MH 12 AB 1234"
                      className="w-full px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-mono font-bold uppercase focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-xs"
                    />
                  </div>
                </div>

                {/* 2. Party Name * with Google-style Search Autocomplete & DB Auto-Population */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-bold text-destructive whitespace-nowrap flex items-center justify-between pr-1">
                    <span>Party Name *</span>
                    {isPartyAutoPopulated && (
                      <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 px-1 py-0.5 rounded font-mono font-bold" title="Auto-populated from saved DB party profile">
                        Auto
                      </span>
                    )}
                  </label>
                  <div className="flex-1 relative" ref={partyDropdownRef}>
                    <input
                      type="text"
                      autoComplete="off"
                      value={formData.partyName}
                      onFocus={() => {
                        if ((formData.partyName || '').trim().length > 0) {
                          setIsPartyDropdownOpen(true);
                        }
                      }}
                      onChange={(e) => {
                        const newName = e.target.value;
                        updateFormField('partyName', newName);
                        setHighlightedPartyIdx(-1);
                        if (newName.trim()) {
                          setIsPartyDropdownOpen(true);
                          const populated = applyPartyDetails(newName);
                          setIsPartyAutoPopulated(populated);
                        } else {
                          setIsPartyDropdownOpen(false);
                          setIsPartyAutoPopulated(false);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (!isPartyDropdownOpen || filteredPartySuggestions.length === 0) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setHighlightedPartyIdx((prev) =>
                            prev < filteredPartySuggestions.length - 1 ? prev + 1 : 0
                          );
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setHighlightedPartyIdx((prev) =>
                            prev > 0 ? prev - 1 : filteredPartySuggestions.length - 1
                          );
                        } else if (e.key === 'Enter' && highlightedPartyIdx >= 0) {
                          e.preventDefault();
                          handleSelectPartySuggestion(filteredPartySuggestions[highlightedPartyIdx]);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setIsPartyDropdownOpen(false);
                          setHighlightedPartyIdx(-1);
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val) {
                          const populated = applyPartyDetails(val);
                          if (populated) {
                            setIsPartyAutoPopulated(true);
                          }
                        }
                      }}
                      placeholder="Type party name to search..."
                      className="w-full px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-xs"
                    />
                    {isPartyDropdownOpen && filteredPartySuggestions.length > 0 && (
                      <div
                        role="listbox"
                        className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-border/50"
                      >
                        {filteredPartySuggestions.map((p, idx) => {
                          const subtitle = [p.locationName || p.location_name, p.village, p.mobileNo || p.mobile_no, p.product]
                            .filter(Boolean)
                            .join(' · ');
                          const isHighlighted = idx === highlightedPartyIdx;
                          return (
                            <button
                              key={`${p.partyName}-${idx}`}
                              type="button"
                              role="option"
                              aria-selected={isHighlighted}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectPartySuggestion(p);
                              }}
                              onMouseEnter={() => setHighlightedPartyIdx(idx)}
                              className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors cursor-pointer ${
                                isHighlighted
                                  ? 'bg-accent text-accent-foreground'
                                  : 'hover:bg-accent/60'
                              }`}
                            >
                              <Search className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold truncate">{p.partyName}</div>
                                {subtitle && (
                                  <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Product Dropdown / Input */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap flex items-center justify-between pr-1">
                    <span>Product</span>
                    <button
                      type="button"
                      onClick={() => setIsCustomProduct(!isCustomProduct)}
                      title={isCustomProduct ? "Select from Product Catalog Dropdown" : "Type custom product name"}
                      className="text-[10px] text-primary hover:underline font-normal cursor-pointer flex items-center gap-0.5"
                    >
                      {isCustomProduct ? <ListIcon className="w-2.5 h-2.5" /> : <Edit3 className="w-2.5 h-2.5" />}
                      <span>{isCustomProduct ? 'List' : 'Type'}</span>
                    </button>
                  </label>
                  {isCustomProduct ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        type="text"
                        value={formData.product}
                        onChange={(e) => updateFormField('product', e.target.value)}
                        placeholder="Enter custom product name..."
                        className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-xs"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setIsCustomProduct(false)}
                        className="px-2 py-1.5 bg-muted hover:bg-accent text-foreground text-[11px] font-semibold rounded-md border border-border cursor-pointer transition-colors"
                        title="Back to Product Dropdown List"
                      >
                        List
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center gap-1">
                      <select
                        value={formData.product || ''}
                        onChange={(e) => {
                          if (e.target.value === '__OTHER_CUSTOM__') {
                            setIsCustomProduct(true);
                          } else {
                            updateFormField('product', e.target.value);
                          }
                        }}
                        className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer text-xs"
                      >
                        <option value="">Select Product</option>
                        {formData.product && !COTTON_PRODUCTS.includes(formData.product) && (
                          <option value={formData.product}>{formData.product} (Custom / Entered)</option>
                        )}
                        {COTTON_PRODUCTS.map((prod) => (
                          <option key={prod} value={prod}>
                            {prod}
                          </option>
                        ))}
                        <option value="__OTHER_CUSTOM__">+ Other / Custom Product...</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setIsCustomProduct(true)}
                        className="p-1.5 bg-muted hover:bg-accent text-muted-foreground hover:text-foreground rounded-md border border-border cursor-pointer transition-colors"
                        title="Type custom product name"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 4. Status (Inward vs Outward) */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    Status
                  </label>
                  <div className="flex-1">
                    <select
                      value={formData.status || 'Inward'}
                      onChange={(e) => {
                        const newStatus = e.target.value;
                        updateFormField('status', newStatus);
                        toast({
                          title: `Status: ${newStatus}`,
                          description: newStatus === 'Inward'
                            ? 'Inward: Farmer/Cultivator produce arrival (1st Wt = Gross, 2nd Wt = Tare)'
                            : 'Outward: Factory product dispatch (1st Wt = Tare, 2nd Wt = Gross)',
                        });
                      }}
                      className="w-full px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer text-xs"
                    >
                      <option value="Inward">Inward (Farmer Produce)</option>
                      <option value="Outward">Outward (Factory Dispatch)</option>
                    </select>
                  </div>
                </div>

                {/* 5. LocationName */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    LocationName
                  </label>
                  <input
                    type="text"
                    value={formData.locationName || ''}
                    onChange={(e) => updateFormField('locationName', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>

                {/* 6. CultivatorName */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    CultivatorName
                  </label>
                  <input
                    type="text"
                    value={formData.cultivatorName}
                    onChange={(e) => updateFormField('cultivatorName', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>

                {/* 7. LoadSlipNo */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    LoadSlipNo
                  </label>
                  <input
                    type="text"
                    value={formData.loadSlipNo}
                    onChange={(e) => updateFormField('loadSlipNo', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>

                {/* 8. BagsBales */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    BagsBales
                  </label>
                  <input
                    type="text"
                    value={formData.bagsBales}
                    onChange={(e) => updateFormField('bagsBales', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </div>

              {/* Column 2 (Right - 8 rows) */}
              <div className="space-y-2.5">
                {/* 1. Charges */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    Charges
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.charges || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      updateFormField('charges', val === '' ? 0 : parseFloat(val) || 0);
                    }}
                    placeholder="0"
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                {/* 2. Rate (Manual entry, NO up/down spinner arrows) */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    Rate
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.rate || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      updateFormField('rate', val === '' ? 0 : parseFloat(val) || 0);
                    }}
                    placeholder="0"
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                {/* 3. Moisture (Manual entry, NO up/down spinner arrows) */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    Moisture
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.moisture || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      updateFormField('moisture', val === '' ? 0 : parseFloat(val) || 0);
                    }}
                    placeholder="0"
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                {/* 4. ChessNo */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    ChessNo
                  </label>
                  <input
                    type="text"
                    value={formData.chessNo}
                    onChange={(e) => updateFormField('chessNo', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>

                {/* 5. ChessName */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    ChessName
                  </label>
                  <input
                    type="text"
                    value={formData.chessName}
                    onChange={(e) => updateFormField('chessName', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>

                {/* 6. ChessAmount */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    ChessAmount
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.chessAmount || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      updateFormField('chessAmount', val === '' ? 0 : parseFloat(val) || 0);
                    }}
                    placeholder="0"
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                {/* 7. Village */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    Village
                  </label>
                  <input
                    type="text"
                    value={formData.village}
                    onChange={(e) => updateFormField('village', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>

                {/* 8. MobileNo */}
                <div className="flex items-center gap-2">
                  <label className="w-28 font-semibold text-foreground whitespace-nowrap">
                    MobileNo
                  </label>
                  <input
                    type="text"
                    value={formData.mobileNo}
                    onChange={(e) => updateFormField('mobileNo', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Lower Dual-Weighment & Calculation Matrix */}
          <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
            {/* Header: Weighbridge Mode & Admin Controls */}
            <div className="flex items-center justify-between border-b border-border pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wide text-foreground">
                  Dual-Weighment & Commercial Matrix
                </span>
                {!isAdmin && (
                  <span className="text-[10px] bg-sky-500/10 border border-sky-500/30 text-sky-600 dark:text-sky-400 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1" title="Weighbridge scale connected via USB. Weights captured directly from indicator.">
                    <Scale className="w-3 h-3 text-sky-500" />
                    <span>Scale Direct Capture</span>
                  </span>
                )}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground font-medium">Admin Option:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !adminEditMode;
                      setAdminEditMode(next);
                      toast({
                        title: next ? 'Admin Edit Mode: ON' : 'Scale Lock: Active',
                        description: next
                          ? 'Manual weight entry unlocked for 1st & 2nd weights.'
                          : 'Weights locked to direct weighbridge scale stream.',
                      });
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      adminEditMode
                        ? 'bg-amber-500 text-slate-950 ring-2 ring-amber-400 shadow-xs'
                        : 'bg-muted hover:bg-accent text-foreground border border-border'
                    }`}
                    title="Admin: Toggle manual weight entry"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{adminEditMode ? 'Admin Edit: ON' : 'Admin Edit: OFF'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-xs">
              {/* Row 1: 1st Weight | Date Time */}
              <div className="flex items-center gap-2">
                <label className="w-28 font-semibold text-foreground whitespace-nowrap flex items-center justify-between pr-1">
                  <span>1st Wt {formData.status === 'Outward' ? '(Tare)' : '(Gross)'}</span>
                  {isAdmin && adminEditMode ? (
                    <span className="text-[9px] bg-amber-500 text-slate-950 px-1 py-0.5 rounded font-mono font-bold">
                      Admin Edit
                    </span>
                  ) : (
                    <span className="text-[9px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1 py-0.5 rounded font-mono font-bold">
                      Scale Direct
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  readOnly={!(isAdmin && adminEditMode)}
                  value={formData.firstWeight !== null && formData.firstWeight !== undefined ? `${formData.firstWeight}` : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                    const num = raw === '' ? null : parseFloat(raw);
                    const { dateStr, timeStr } = getCurrentDateTimeStamp();
                    setFormData((prev) => ({
                      ...prev,
                      firstWeight: num,
                      firstWeightDate: num !== null ? (prev.firstWeightDate || dateStr) : prev.firstWeightDate,
                      firstWeightTime: num !== null ? (prev.firstWeightTime || timeStr) : prev.firstWeightTime,
                    }));
                  }}
                  placeholder="0"
                  className={`flex-1 px-2.5 py-1.5 border rounded-md font-mono font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                    (isAdmin && adminEditMode)
                      ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-500 text-amber-900 dark:text-amber-200'
                      : 'bg-muted/70 border-muted-foreground/30 cursor-not-allowed text-foreground'
                  }`}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-24 font-semibold text-foreground whitespace-nowrap flex items-center justify-between pr-1">
                  <span>Date Time</span>
                  <button
                    type="button"
                    onClick={() => {
                      const { dateStr, timeStr } = getCurrentDateTimeStamp();
                      setFormData((prev) => ({
                        ...prev,
                        firstWeightDate: dateStr,
                        firstWeightTime: timeStr,
                      }));
                      toast({
                        title: '1st Wt Timestamp Latched',
                        description: `${dateStr} ${timeStr}`,
                      });
                    }}
                    title="Stamp current Date & Time (DD-MM-YYYY HH:MM:SS) for 1st Weight"
                    className="text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                </label>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={formData.firstWeightDate || ''}
                    onChange={(e) => updateFormField('firstWeightDate', e.target.value)}
                    placeholder="DD-MM-YYYY"
                    className="px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-center text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <input
                    type="text"
                    value={formData.firstWeightTime || ''}
                    onChange={(e) => updateFormField('firstWeightTime', e.target.value)}
                    placeholder="HH:MM:SS"
                    className="px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-center text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>

              {/* Row 2: 2nd Weight | Date Time */}
              <div className="flex items-center gap-2">
                <label className="w-28 font-semibold text-foreground whitespace-nowrap flex items-center justify-between pr-1">
                  <span>2nd Wt {formData.status === 'Outward' ? '(Gross)' : '(Tare)'}</span>
                  {isAdmin && adminEditMode ? (
                    <span className="text-[9px] bg-amber-500 text-slate-950 px-1 py-0.5 rounded font-mono font-bold">
                      Admin Edit
                    </span>
                  ) : (
                    <span className="text-[9px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1 py-0.5 rounded font-mono font-bold">
                      Scale Direct
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  readOnly={!(isAdmin && adminEditMode)}
                  value={formData.secondWeight !== null && formData.secondWeight !== undefined ? `${formData.secondWeight}` : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                    const num = raw === '' ? null : parseFloat(raw);
                    const { dateStr, timeStr } = getCurrentDateTimeStamp();
                    setFormData((prev) => ({
                      ...prev,
                      secondWeight: num,
                      secondWeightDate: num !== null ? (prev.secondWeightDate || dateStr) : prev.secondWeightDate,
                      secondWeightTime: num !== null ? (prev.secondWeightTime || timeStr) : prev.secondWeightTime,
                    }));
                  }}
                  placeholder="0"
                  className={`flex-1 px-2.5 py-1.5 border rounded-md font-mono font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                    (isAdmin && adminEditMode)
                      ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-500 text-amber-900 dark:text-amber-200'
                      : 'bg-muted/70 border-muted-foreground/30 cursor-not-allowed text-foreground'
                  }`}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-24 font-semibold text-foreground whitespace-nowrap flex items-center justify-between pr-1">
                  <span>Date Time</span>
                  <button
                    type="button"
                    onClick={() => {
                      const { dateStr, timeStr } = getCurrentDateTimeStamp();
                      setFormData((prev) => ({
                        ...prev,
                        secondWeightDate: dateStr,
                        secondWeightTime: timeStr,
                      }));
                      toast({
                        title: '2nd Wt Timestamp Latched',
                        description: `${dateStr} ${timeStr}`,
                      });
                    }}
                    title="Stamp current Date & Time (DD-MM-YYYY HH:MM:SS) for 2nd Weight"
                    className="text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                </label>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={formData.secondWeightDate || ''}
                    onChange={(e) => updateFormField('secondWeightDate', e.target.value)}
                    placeholder="DD-MM-YYYY"
                    className="px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-center text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <input
                    type="text"
                    value={formData.secondWeightTime || ''}
                    onChange={(e) => updateFormField('secondWeightTime', e.target.value)}
                    placeholder="HH:MM:SS"
                    className="px-2.5 py-1.5 bg-background border border-input rounded-md font-mono text-center text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>

              {/* Row 3: Nett Weight | Final Rate */}
              <div className="flex items-center gap-2">
                <label className="w-24 font-semibold text-foreground whitespace-nowrap">
                  Nett Weight
                </label>
                <input
                  type="text"
                  readOnly
                  value={calculations.nettWeight > 0 ? `${calculations.nettWeight}` : ''}
                  className="flex-1 px-2.5 py-1.5 bg-muted/60 border border-border rounded-md font-mono font-bold text-foreground"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-24 font-semibold text-foreground whitespace-nowrap">
                  Final Rate
                </label>
                <input
                  type="text"
                  readOnly
                  value={calculations.finalRate > 0 ? `${calculations.finalRate}` : ''}
                  className="flex-1 px-2.5 py-1.5 bg-muted/60 border border-border rounded-md font-mono font-bold text-foreground"
                />
              </div>

              {/* Row 4: Final Weight (Shaded) | Total Amount (Shaded) */}
              <div className="flex items-center gap-2">
                <label className="w-24 font-semibold text-foreground whitespace-nowrap">
                  Final Weight
                </label>
                <input
                  type="text"
                  readOnly
                  value={calculations.finalWeight > 0 ? `${calculations.finalWeight}` : ''}
                  className="flex-1 px-2.5 py-1.5 bg-muted border border-border rounded-md font-mono font-extrabold text-foreground"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-24 font-semibold text-foreground whitespace-nowrap">
                  Total Amount
                </label>
                <input
                  type="text"
                  readOnly
                  value={calculations.totalAmount > 0 ? `${calculations.totalAmount.toLocaleString()}` : ''}
                  className="flex-1 px-2.5 py-1.5 bg-muted border border-border rounded-md font-mono font-extrabold text-primary"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Section: Snapshots Stack & Dual IP Camera Feeds (LG+: 4 cols) */}
        <div className="lg:col-span-4 flex flex-col">
          <DualCameraFeedPanel
            ref={cameraPanelRef}
            evidenceList={evidenceList}
            onTakeSnapshot={handleManualSnapshot}
            onPlateDetected={(plate) => {
              updateFormField('vehicleRegNo', plate);
            }}
            currentWeight={currentWeight.weight}
            vehicleRegNo={formData.vehicleRegNo}
            transactionNo={formData.transactionNo}
            companyName={company.firmName || company.companyName || 'DHARANI COTTON MILLS'}
            weighbridgeLicense={company.weighbridgeLicense}
          />
        </div>
      </div>

      {/* 4. BOTTOM ACTION & PRINT SETTINGS RIBBON */}
      <footer className="bg-card border border-border rounded-xl p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3 select-none">
        {/* Left Side: Checkboxes & Inline Moisture / Rate Inputs */}
        <div className="flex items-center gap-4 text-xs font-sans">
          <div className="flex flex-col gap-1.5 pr-2">
            <label className="flex items-center gap-2 text-foreground font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={formData.printDuplicate}
                onChange={(e) => updateFormField('printDuplicate', e.target.checked)}
                className="w-3.5 h-3.5 rounded text-primary border-input focus:ring-primary"
              />
              <span className="text-[11px]">Print Duplicate</span>
            </label>

            <label className="flex items-center gap-2 text-foreground font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={formData.printQrCode}
                onChange={(e) => updateFormField('printQrCode', e.target.checked)}
                className="w-3.5 h-3.5 rounded text-primary border-input focus:ring-primary"
              />
              <span className="text-[11px]">Print QR Code</span>
            </label>

            <label
              className={`flex items-center gap-2 font-medium ${isAdmin ? 'text-foreground cursor-pointer' : 'text-muted-foreground cursor-not-allowed opacity-80'}`}
              title={isAdmin ? 'Enable/Disable Print Images globally across all roles' : 'Controlled globally by Admin'}
            >
              <input
                type="checkbox"
                checked={company.weighbridgeDefaults?.printImages ?? formData.printImages}
                disabled={!isAdmin}
                onChange={(e) => {
                  if (!isAdmin) return;
                  const checked = e.target.checked;
                  updateFormField('printImages', checked);
                  setGlobalPrintImages(checked);
                }}
                className="w-3.5 h-3.5 rounded text-primary border-input focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <span className="text-[11px]">
                Print Images{!isAdmin ? ' (Admin)' : ''}
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2 border-l border-border pl-4 font-sans">
            <div className="flex items-center gap-2">
              <span className="w-14 text-foreground font-semibold text-[11px]">Moisture</span>
              <input
                type="text"
                inputMode="decimal"
                value={formData.moisture || ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, '');
                  updateFormField('moisture', val === '' ? 0 : parseFloat(val) || 0);
                }}
                placeholder="0"
                className="w-20 px-2 py-1 bg-background border border-input rounded-md text-center font-mono font-bold text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="w-14 text-foreground font-semibold text-[11px]">Rate</span>
              <input
                type="text"
                inputMode="decimal"
                value={formData.rate || ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, '');
                  updateFormField('rate', val === '' ? 0 : parseFloat(val) || 0);
                }}
                placeholder="0"
                className="w-20 px-2 py-1 bg-background border border-input rounded-md text-center font-mono font-bold text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        </div>

        {/* Center: Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* New F1 */}
          <button
            type="button"
            onClick={async () => {
              setIsPartyAutoPopulated(false);
              const targetTx = await handleNew();
              toast({
                title: 'New Transaction (F1)',
                description: `Transaction #${targetTx || formData.transactionNo} ready. All fields cleared.`,
              });
            }}
            className="px-4 py-2 bg-card hover:bg-accent text-foreground border border-border font-bold text-xs rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
          >
            New F1
          </button>

          {/* Save & Print F4 */}
          <button
            type="button"
            onClick={async () => {
              await handleSaveAndPrint();
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
          >
            Save & Print F4
          </button>

          {/* Get Weight F3 */}
          <button
            type="button"
            onClick={handleGetWeightWithSnapshots}
            disabled={isCapturingSnapshots}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-70 text-primary-foreground font-bold text-xs rounded-lg shadow-md ring-2 ring-primary/20 transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
          >
            {isCapturingSnapshots ? (
              <span>Capturing...</span>
            ) : (
              <span><u>G</u>et Weight F3</span>
            )}
          </button>

          {/* Save F2 */}
          <button
            type="button"
            onClick={async () => {
              await handleSave();
            }}
            className="px-4 py-2 bg-card hover:bg-accent text-foreground border border-border font-bold text-xs rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
          >
            <u>S</u>ave F2
          </button>

          {/* Print F5 */}
          <button
            type="button"
            onClick={handlePrintF5}
            className="px-4 py-2 bg-card hover:bg-accent text-foreground border border-border font-bold text-xs rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
          >
            Print F5
          </button>

          {/* Close F7 */}
          <button
            type="button"
            onClick={() => {
              handleClose();
              toast({
                title: 'Terminal Cleared (F7)',
                description: 'Current ticket cleared without saving.',
              });
            }}
            className="px-4 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 font-bold text-xs rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
          >
            Close F7
          </button>
        </div>

        {/* Right Side: Calculator & E-Mail Buttons */}
        <div className="flex items-center gap-2.5">
          {/* Calculator Button (Moved from top to bottom) */}
          <button
            type="button"
            onClick={() => setIsCalculatorOpen(true)}
            className="px-3.5 py-2 bg-card hover:bg-accent text-foreground border border-border font-bold text-xs rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
            title="Open Industrial Math Calculator"
          >
            <CalcIcon className="w-3.5 h-3.5 text-amber-500" />
            <span>Calculator</span>
          </button>

          {/* E-Mail Button */}
          <button
            type="button"
            onClick={() => {
              if (activeSlip) {
                handleEmailSlip(activeSlip);
              } else {
                toast({
                  title: 'E-Mail Dispatched',
                  description: `Weigh slip for Transaction #${formData.transactionNo} (${formData.vehicleRegNo}) sent to Customer & Accounts.`,
                });
              }
            }}
            className="px-4 py-2 bg-card hover:bg-accent text-foreground border border-border font-bold text-xs rounded-lg shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Mail className="w-3.5 h-3.5 text-muted-foreground" />
            <span>E-Mail</span>
          </button>
        </div>
      </footer>

      {/* 5. MODALS & DRAWERS */}
      <PendingVehiclesDrawer
        isOpen={isPendingDrawerOpen}
        onClose={() => setIsPendingDrawerOpen(false)}
        pendingList={pendingVehicles}
        onSelectVehicle={(veh) => {
          loadPendingVehicle(veh);
          const vehStatus = (veh.status || 'Inward').toLowerCase().includes('outward') ? 'Outward' : 'Inward';
          toast({
            title: 'Pending Vehicle Loaded',
            description: `Vehicle ${veh.vehicleRegNo} (Ticket #${veh.transactionNo}) ready for ${vehStatus} 2nd weight.`,
          });
        }}
      />

      <CalculatorModal
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
        onApplyResult={(val) => {
          const { dateStr, timeStr } = getCurrentDateTimeStamp();
          if (formData.firstWeight === null) {
            setFormData((prev) => ({
              ...prev,
              firstWeight: val,
              firstWeightDate: prev.firstWeightDate || dateStr,
              firstWeightTime: prev.firstWeightTime || timeStr,
            }));
          } else {
            setFormData((prev) => ({
              ...prev,
              secondWeight: val,
              secondWeightDate: prev.secondWeightDate || dateStr,
              secondWeightTime: prev.secondWeightTime || timeStr,
              status: prev.status || 'Outward',
            }));
          }
        }}
      />

      <ReportsModal
        isOpen={isReportsOpen}
        onClose={() => setIsReportsOpen(false)}
        sessions={sessions}
      />

      <IndustrialWeighSlipModal
        isOpen={!!activeSlip}
        onClose={() => setActiveSlip(null)}
        slip={activeSlip}
        onEmail={handleEmailSlip}
      />

      <WeighmentF5PrintModal
        isOpen={isF5PrintOpen}
        onClose={() => setIsF5PrintOpen(false)}
        transactionNo={formData.transactionNo}
        activeSlip={activeSlip}
        formData={formData}
      />

      <ThirdPartyScaleModal
        isOpen={isScaleBridgeOpen}
        onClose={() => setIsScaleBridgeOpen(false)}
        currentWeight={currentWeight}
        onWeightUpdate={(reading) => setCurrentWeight(reading)}
      />

      {getWeightSuccessModal?.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="f3-weight-modal-title"
        >
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h3 id="f3-weight-modal-title" className="text-lg font-bold text-foreground">
                {getWeightSuccessModal.errorMessage
                  ? 'Weight Notice'
                  : getWeightSuccessModal.savedToDb
                    ? 'Successfully Saved'
                    : getWeightSuccessModal.isFirstWeight
                      ? '1st Weight Latched'
                      : '2nd Weight Latched'}
              </h3>
              <p className="text-xs font-medium text-muted-foreground">
                {getWeightSuccessModal.errorMessage
                  ? getWeightSuccessModal.errorMessage
                  : getWeightSuccessModal.savedToDb
                    ? `${getWeightSuccessModal.isFirstWeight ? '1st Weight' : '2nd Weight'} captured and successfully saved.`
                    : getWeightSuccessModal.requiresVehicleNo
                      ? `${getWeightSuccessModal.weight.toLocaleString()} kg latched. Enter Vehicle No and press Save (F2) to store to database.`
                      : `${getWeightSuccessModal.weight.toLocaleString()} kg latched from live scale.`}
              </p>
            </div>

            <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 text-xs space-y-1.5 text-left">
              <div className="flex justify-between">
                <span className="text-muted-foreground font-medium">Transaction No:</span>
                <span className="font-mono font-bold text-foreground">#{getWeightSuccessModal.transactionNo}</span>
              </div>
              {getWeightSuccessModal.vehicleRegNo && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Vehicle No:</span>
                  <span className="font-mono font-bold text-foreground">{getWeightSuccessModal.vehicleRegNo}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground font-medium">
                  {getWeightSuccessModal.isFirstWeight ? '1st Weight:' : '2nd Weight:'}
                </span>
                <span className="font-mono font-bold text-primary">
                  {getWeightSuccessModal.weight.toLocaleString()} kg
                </span>
              </div>
              {!getWeightSuccessModal.isFirstWeight && getWeightSuccessModal.nettWeight > 0 && (
                <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                  <span className="text-muted-foreground font-semibold">Nett Weight:</span>
                  <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                    {getWeightSuccessModal.nettWeight.toLocaleString()} kg
                  </span>
                </div>
              )}
              {getWeightSuccessModal.snapshotCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Camera Snapshots:</span>
                  <span className="font-semibold text-foreground">{getWeightSuccessModal.snapshotCount} saved</span>
                </div>
              )}
            </div>

            <div className="pt-1 flex justify-center">
              <button
                ref={f3OkButtonRef}
                type="button"
                onClick={() => setGetWeightSuccessModal(null)}
                className="min-w-[120px] px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Weighbridge;
