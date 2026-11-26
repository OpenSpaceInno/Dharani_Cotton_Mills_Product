import { useState, useEffect, useRef } from "react";
import { LogIn, Activity, Loader2, RefreshCw, CloudDownload, Trash2, Camera } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LiveFeedViewer } from "@/components/gate/LiveFeedViewer";
import { SimplePlateDisplay } from "@/components/gate/SimplePlateDisplay";
import { useGateCameras } from "@/hooks/useGateCameras";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const GateMonitor = () => {
  const { canAccessRoute, hasPermission, role, user } = useAuth();
  const isGateOperator = role?.id === "gate_operator" || user?.roleId === "gate_operator";
  const canConfigureDevices = canAccessRoute("/device-config") || hasPermission("config:manage");

  const { cameras, initialized } = useGateCameras();
  const [dbInitialized, setDbInitialized] = useState(false);
  const [checkingDb, setCheckingDb] = useState(true);
  const [detectedPlate, setDetectedPlate] = useState<string>("");
  const [detectedConfidence, setDetectedConfidence] = useState<number>(0);
  const [isConnected] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const manualCaptureRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    checkDatabaseTables();
  }, []);

  // Synchronize real ANPR events from FTP Camera Watcher & Backend
  useEffect(() => {
    let active = true;

    const fetchLatestGate = async () => {
      try {
        const res = await api.getLatestGateVehicle();
        if (!active) return;
        if (res && res.success && res.vehicleRegNo) {
          setDetectedPlate(res.vehicleRegNo);
          setDetectedConfidence(res.confidence || 0.98);
        }
      } catch (err) {
        // Silently catch
      }
    };

    fetchLatestGate();
    const interval = setInterval(fetchLatestGate, 3000);

    // Cross-tab broadcast listener
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('rmc_gate_sync');
      channel.onmessage = (event) => {
        if (!active) return;
        if (event.data?.type === 'GATE_VEHICLE_DETECTED' && event.data.vehicleRegNo) {
          setDetectedPlate(event.data.vehicleRegNo);
          setDetectedConfidence(event.data.confidence || 0.98);
        } else if (event.data?.type === 'GATE_VEHICLE_CLEARED') {
          setDetectedPlate('');
          setDetectedConfidence(0);
        }
      };
    } catch (e) {}

    return () => {
      active = false;
      clearInterval(interval);
      if (channel) channel.close();
    };
  }, []);

  const checkDatabaseTables = async () => {
    try {
      const status = await api.checkDatabaseStatus();
      setDbInitialized(status.initialized);
    } catch (error) {
      console.log('Database tables not initialized yet', error);
      setDbInitialized(false);
    } finally {
      setCheckingDb(false);
    }
  };

  const initializeDatabase = () => {
    window.location.href = '/database-setup';
  };

  // Sync latest existing detection from FTP Camera
  const handleSyncFtpNow = async () => {
    try {
      setIsProcessing(true);
      const res = await api.syncFtpNow(true);
      if (res && res.success && res.detection?.vehicleRegNo) {
        const plate = res.detection.vehicleRegNo;
        const imageUrl = res.detection.imageUrl || res.detection.evidenceImageUrl || (res.detection.fileName ? `/snapshots/${res.detection.fileName}` : '');
        setDetectedPlate(plate);
        setDetectedConfidence(0.98);
        handlePlateDetected(plate, 0.98, imageUrl);
        toast.success(`FTP Camera Synced: ${plate}`, {
          description: `Real vehicle detected from FTP file ${res.detection.fileName || 'camera upload'}`,
        });
      } else {
        toast.info("FTP Polled", {
          description: "No new vehicle detection files found on FTP server.",
        });
      }
    } catch (err: any) {
      toast.error("FTP Sync Failed", {
        description: err.message || "Could not connect to FTP server.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Clear current vehicle
  const handleClearVehicle = async () => {
    try {
      await api.clearGateVehicle();
      setDetectedPlate('');
      setDetectedConfidence(0);
      try {
        localStorage.removeItem('rmc_gate_latest_vehicle');
        const channel = new BroadcastChannel('rmc_gate_sync');
        channel.postMessage({ type: 'GATE_VEHICLE_CLEARED' });
        channel.close();
      } catch (e) {}
      toast.info("Vehicle cleared from Gate Monitor");
    } catch (err) {}
  };

  // Handle plate detection from live camera
  const handlePlateDetected = (plate: string, confidence: number, imageUrl?: string) => {
    console.log('✅ Plate detected and displayed:', plate, 'Confidence:', confidence);
    setDetectedPlate(plate);
    setDetectedConfidence(confidence);

    const cleanPlate = plate.replace(/\s+/g, '').toUpperCase();

    // 1. Sync to localStorage for immediate cross-tab access
    try {
      localStorage.setItem('rmc_gate_latest_vehicle', JSON.stringify({
        vehicleRegNo: cleanPlate,
        confidence,
        imageUrl: imageUrl || '',
        timestamp: new Date().toISOString()
      }));
    } catch (e) {}

    // 2. Post to backend API so Weighbridge can fetch from database
    api.postLatestGateVehicle({
      vehicleRegNo: cleanPlate,
      confidence,
      source: 'Gate Entry ANPR Camera (FTP)',
      imageUrl: imageUrl || ''
    }).catch(err => console.warn('Could not post gate vehicle to backend:', err));

    // 3. Broadcast real-time event to Weighbridge module
    try {
      const channel = new BroadcastChannel('rmc_gate_sync');
      channel.postMessage({
        type: 'GATE_VEHICLE_DETECTED',
        vehicleRegNo: cleanPlate,
        confidence,
        imageUrl: imageUrl || '',
        timestamp: new Date().toISOString()
      });
      channel.close();
    } catch (e) {}

    window.dispatchEvent(new CustomEvent('rmc_gate_vehicle_detected', {
      detail: { vehicleRegNo: cleanPlate, confidence, imageUrl: imageUrl || '' }
    }));
  };

  // Handle manual capture
  const handleManualCapture = () => {
    console.log('🔘 Manual capture button clicked');
    
    // Try ref first
    if (manualCaptureRef.current) {
      console.log('✅ Using ref-based capture');
      manualCaptureRef.current();
      return;
    }
    
    // Fallback to window object
    if ((window as any).__manualCapture) {
      console.log('✅ Using window-based capture');
      (window as any).__manualCapture();
      return;
    }
    
    console.error('❌ No capture function available');
  };

  // Callback to receive capture function from LiveANPRDetector
  const registerManualCapture = (captureFunc: () => void) => {
    console.log('📝 Registering manual capture function');
    manualCaptureRef.current = captureFunc;
  };

  if (checkingDb) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
          <p className="text-muted-foreground">Checking system status...</p>
        </div>
      </div>
    );
  }

  if (!dbInitialized) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <LogIn className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Gate Monitor</h1>
          </div>
        </div>

        <Alert>
          <AlertDescription>
            <div className="space-y-4">
              <p className="font-medium">Database tables need to be initialized first.</p>
              <p className="text-sm text-muted-foreground">
                This is a one-time setup that will create the necessary tables for camera configuration and RTSP streaming.
              </p>
              <Button onClick={initializeDatabase}>
                Initialize Database
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20">
            <LogIn className="h-7 w-7 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Gate Monitor</h1>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 text-xs gap-1 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {cameras.length === 1 ? '1 CONFIGURED CAMERA' : `${cameras.length} CONFIGURED CAMERAS`}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Camera Hardware Network Status Bar hidden for clean gate security monitoring view */}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 gap-6">
        {/* Live Camera Feeds */}
        {!initialized ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2].map((n) => (
              <div key={n} className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ))}
          </div>
        ) : cameras.length === 0 ? (
          <div className="p-8 border border-dashed rounded-lg bg-card/40 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Camera className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">No Cameras Configured</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
                You have not registered any cameras in Device Config yet. Register your IP or ANPR cameras to view live CCTV streams and automated gate recognition.
              </p>
            </div>
            {canConfigureDevices ? (
              <Button onClick={() => window.location.href = '/device-config'} className="gap-2">
                Configure Cameras Now
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Please contact your Plant Administrator to configure cameras in Device Config.
              </p>
            )}
          </div>
        ) : (
          <div className={`grid grid-cols-1 ${cameras.length > 1 ? 'md:grid-cols-2' : ''} gap-6`}>
            {cameras.map((camera, idx) => (
              <LiveFeedViewer 
                key={camera.id} 
                camera={camera}
                enableANPR={idx === 0 || (camera.name && camera.name.toLowerCase().includes('anpr')) || (camera.location && camera.location.toLowerCase().includes('entry')) || camera.id === 'cam_gate_1'}
                onPlateDetected={handlePlateDetected}
                onRegisterCapture={registerManualCapture}
              />
            ))}
          </div>
        )}

        {/* Detected Plate Display */}
        <SimplePlateDisplay 
          plateNumber={detectedPlate}
          confidence={detectedConfidence}
        />
      </div>
    </div>
  );
};

export default GateMonitor;
