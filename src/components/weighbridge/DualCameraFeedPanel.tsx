import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Camera, RefreshCw, CheckCircle2, Eye, Scan, Maximize2, Play, Activity, Sparkles } from 'lucide-react';
import Hls from 'hls.js';
import { Evidence } from '@/types/weighbridge';
import { api } from '@/lib/api';
import { useWeighbridgeSimulatedFeeds } from './useWeighbridgeSimulatedFeeds';

export interface DualCameraFeedPanelHandle {
  captureAllSnapshots: (metadata?: { weight?: number; vehicleNo?: string; transactionNo?: number }) => Promise<Array<{
    camId: string;
    camName: string;
    angle: 'front' | 'side' | 'rear';
    dataUrl: string;
  }>>;
  captureSingleSnapshot: (screenIndex: number, metadata?: { weight?: number; vehicleNo?: string; transactionNo?: number }) => Promise<{
    camId: string;
    camName: string;
    angle: 'front' | 'side' | 'rear';
    dataUrl: string;
  } | null>;
  fetchDetectedPlate: () => string;
}

interface CameraConfig {
  id: string;
  name: string;
  angle: 'front' | 'side' | 'rear';
  ip: string;
  port: string;
  user: string;
  pass: string;
  hlsUrl: string;
  status: 'connected' | 'connecting' | 'standby';
  plateSample: string;
}

export interface DualCameraFeedPanelProps {
  evidenceList: Evidence[];
  onTakeSnapshot?: (angle: 'front' | 'side' | 'rear') => void;
  onPlateDetected?: (plate: string) => void;
  currentWeight?: number;
  vehicleRegNo?: string;
  transactionNo?: number;
  companyName?: string;
  weighbridgeLicense?: string;
}

export const DualCameraFeedPanel = forwardRef<DualCameraFeedPanelHandle, DualCameraFeedPanelProps>(({
  evidenceList,
  onTakeSnapshot,
  onPlateDetected,
  currentWeight = 0,
  vehicleRegNo = '',
  transactionNo = 0,
  companyName = 'DHARANI COTTON MILLS / APARNA RMC',
  weighbridgeLicense = 'WB/2026/RMC-449',
}, ref) => {
  const [cameras, setCameras] = useState<CameraConfig[]>([
    {
      id: 'cam_gate_1',
      name: 'Camera 1 (Front ANPR)',
      angle: 'front',
      ip: '192.168.0.101',
      port: '554',
      user: 'admin',
      pass: '••••••••',
      hlsUrl: '/hls/cam1/index.m3u8',
      status: 'connecting',
      plateSample: '',
    },
    {
      id: 'cam_scale_1',
      name: 'Camera 2 (Deck & Scale)',
      angle: 'side',
      ip: '192.168.0.102',
      port: '554',
      user: 'admin',
      pass: '••••••••',
      hlsUrl: '/hls/cam2/index.m3u8',
      status: 'connecting',
      plateSample: '',
    },
    {
      id: 'cam_gate_3',
      name: 'Camera 3 (Platform 2)',
      angle: 'rear',
      ip: '192.168.10.203',
      port: '554',
      user: 'admin',
      pass: '••••••••',
      hlsUrl: '/hls/cam3/index.m3u8',
      status: 'connecting',
      plateSample: '',
    },
  ]);

  const [availableCameras, setAvailableCameras] = useState<any[]>([]);

  // Helper to ensure standard HLS playlist path (converts to relative same-origin /hls/... to avoid CORS/port issues)
  const normalizeHlsStreamUrl = (url?: string, defaultSlug = 'cam1') => {
    let u = (url || '').trim();
    while (u.endsWith('/')) u = u.slice(0, -1);
    
    if (u.includes('localhost:8888/')) {
      const slug = u.split('localhost:8888/')[1].replace(/\/+$/, '').replace(/\/index\.m3u8$/, '');
      return `/hls/${slug}/index.m3u8`;
    }
    if (!u) {
      return `/hls/${defaultSlug}/index.m3u8`;
    }
    if (u.startsWith('cam')) {
      return `/hls/${u}/index.m3u8`;
    }
    if (!u.endsWith('.m3u8')) {
      return `${u}/index.m3u8`;
    }
    return u;
  };

  const getCameraSlug = (devId = '', name = '', defaultIndex = 0) => {
    const d = devId.toLowerCase();
    const n = name.toLowerCase();
    if (d.includes('3') || d.includes('gate_3') || n.includes('camera 3') || n.includes('platform 2') || d.includes('rear') || n.includes('rear')) return 'cam3';
    if (d.includes('scale') || d.includes('2') || d.includes('gate_2') || d.includes('gate_4') || n.includes('camera 2') || n.includes('overhead')) return 'cam2';
    if (d.includes('1') || d.includes('gate_1') || n.includes('camera 1') || n.includes('anpr') || n.includes('front')) return 'cam1';
    return `cam${defaultIndex + 1}`;
  };

  // Switch camera for a specific screen slot
  const handleSelectCamera = (screenIdx: number, selectedDevId: string) => {
    const targetCam = availableCameras.find(c => (c.device_id || c.id) === selectedDevId);
    if (!targetCam) return;

    setCameras(prev => {
      const next = [...prev];
      const slug = getCameraSlug(targetCam.device_id || targetCam.id || '', targetCam.name || '', screenIdx);
      
      next[screenIdx] = {
        ...next[screenIdx],
        id: targetCam.device_id || targetCam.id,
        name: targetCam.name || `Camera ${screenIdx + 1}`,
        ip: targetCam.ip_address || '',
        hlsUrl: normalizeHlsStreamUrl(targetCam.hls_proxy_url || slug, slug),
        status: 'connecting',
      };
      return next;
    });
  };

  // Load configured cameras from Database and stay in sync with Device Config
  useEffect(() => {
    let active = true;
    const loadDbCameras = async () => {
      try {
        const dbCams = await api.getCameras();
        if (!active || !Array.isArray(dbCams) || dbCams.length === 0) return;
        setAvailableCameras(dbCams);

        // Find primary ANPR / Front camera (Gate 1 Entry)
        const primaryCam = dbCams.find((c: any) => 
          c.device_id === 'cam_gate_1' || 
          c.name?.toLowerCase().includes('camera 1') || 
          c.name?.toLowerCase().includes('gate 1') || 
          c.name?.toLowerCase().includes('entry') ||
          c.name?.toLowerCase().includes('front')
        ) || dbCams[0];

        // Find secondary Overview / Scale camera
        const secondaryCam = dbCams.find((c: any) => 
          (c.device_id === 'cam_scale_1' || 
           c.name?.toLowerCase().includes('camera 2') || 
           c.name?.toLowerCase().includes('scale') || 
           c.name?.toLowerCase().includes('overhead') ||
           c.device_id === 'cam_gate_4' || 
           c.device_id === 'cam_gate_2') &&
          (c.device_id || c.id) !== (primaryCam?.device_id || primaryCam?.id)
        ) || dbCams.find((c: any) => (c.device_id || c.id) !== (primaryCam?.device_id || primaryCam?.id)) || dbCams[1] || primaryCam;

        // Find 3rd camera (Platform 2 / Rear)
        const tertiaryCam = dbCams.find((c: any) => 
          (c.device_id === 'cam_gate_3' || 
           c.name?.toLowerCase().includes('camera 3') || 
           c.name?.toLowerCase().includes('platform 2') ||
           c.name?.toLowerCase().includes('rear') ||
           c.name?.toLowerCase().includes('gate 3')) &&
          (c.device_id || c.id) !== (primaryCam?.device_id || primaryCam?.id) &&
          (c.device_id || c.id) !== (secondaryCam?.device_id || secondaryCam?.id)
        ) || dbCams.find((c: any) => (c.device_id || c.id) !== (primaryCam?.device_id || primaryCam?.id) && (c.device_id || c.id) !== (secondaryCam?.device_id || secondaryCam?.id)) || dbCams[2] || primaryCam;

        setCameras([
          {
            id: primaryCam?.device_id || primaryCam?.id || 'cam_gate_1',
            name: primaryCam?.name || 'Camera 1 (Front ANPR)',
            angle: 'front',
            ip: primaryCam?.ip_address || '192.168.10.201',
            port: String(primaryCam?.rtsp_port || 554),
            user: primaryCam?.rtsp_username || 'admin',
            pass: '••••••••',
            hlsUrl: normalizeHlsStreamUrl(primaryCam?.hls_proxy_url || 'cam1', 'cam1'),
            status: 'connecting',
            plateSample: '',
          },
          {
            id: secondaryCam?.device_id || secondaryCam?.id || 'cam_scale_1',
            name: secondaryCam?.name || 'Camera 2 (Deck & Scale)',
            angle: 'side',
            ip: secondaryCam?.ip_address || '192.168.10.202',
            port: String(secondaryCam?.rtsp_port || 554),
            user: secondaryCam?.rtsp_username || 'admin',
            pass: '••••••••',
            hlsUrl: normalizeHlsStreamUrl(secondaryCam?.hls_proxy_url || 'cam2', 'cam2'),
            status: 'connecting',
            plateSample: '',
          },
          {
            id: tertiaryCam?.device_id || tertiaryCam?.id || 'cam_gate_3',
            name: tertiaryCam?.name || 'Camera 3 (Platform 2)',
            angle: 'rear',
            ip: tertiaryCam?.ip_address || '192.168.10.203',
            port: String(tertiaryCam?.rtsp_port || 554),
            user: tertiaryCam?.rtsp_username || 'admin',
            pass: '••••••••',
            hlsUrl: normalizeHlsStreamUrl(tertiaryCam?.hls_proxy_url || 'cam3', 'cam3'),
            status: 'connecting',
            plateSample: '',
          },
        ]);
      } catch (err) {}
    };

    loadDbCameras();

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('rmc_camera_sync');
      channel.onmessage = () => {
        if (active) loadDbCameras();
      };
    } catch (e) {}

    const handleWindowSync = () => {
      if (active) loadDbCameras();
    };
    window.addEventListener('rmc_camera_sync', handleWindowSync);

    return () => {
      active = false;
      if (channel) channel.close();
      window.removeEventListener('rmc_camera_sync', handleWindowSync);
    };
  }, []);

  const [streamStatuses, setStreamStatuses] = useState<Record<number, 'connected' | 'connecting' | 'standby'>>({
    0: 'connecting',
    1: 'connecting',
    2: 'connecting',
  });

  const [activePreview, setActivePreview] = useState<string | null>(null);

  // Video refs for all configured cameras
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const hlsInstances = useRef<(Hls | null)[]>([]);
  const reconnectTimers = useRef<(any)[]>([]);
  const camerasRef = useRef(cameras);
  camerasRef.current = cameras;

  // Live Canvas-to-Video Streaming for all 3 Viewports
  const { startFeed, stopFeed } = useWeighbridgeSimulatedFeeds({
    videoRefs,
    vehicleRegNo,
    currentWeight,
    transactionNo,
    companyName,
  });

  // Connect HLS stream for a given camera index
  const initHls = useCallback((index: number, urlOverride?: string) => {
    const video = videoRefs.current[index];
    if (!video) return;

    if (video.srcObject) {
      video.srcObject = null;
    }

    if (reconnectTimers.current[index]) {
      clearTimeout(reconnectTimers.current[index]);
      reconnectTimers.current[index] = null;
    }

    if (hlsInstances.current[index]) {
      try {
        hlsInstances.current[index]?.destroy();
      } catch (e) {}
      hlsInstances.current[index] = null;
    }

    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.playsInline = true;
    video.autoplay = true;

    setStreamStatuses(prev => {
      if (prev[index] === 'connecting') return prev;
      return { ...prev, [index]: 'connecting' };
    });

    const defaultSlug = index === 0 ? 'cam1' : (index === 1 ? 'cam2' : 'cam3');
    const streamUrl = urlOverride || camerasRef.current[index]?.hlsUrl || `/hls/${defaultSlug}/index.m3u8`;
    const targetUrl = normalizeHlsStreamUrl(streamUrl, defaultSlug);

    const scheduleReconnect = (delayMs = 5000) => {
      if (reconnectTimers.current[index]) clearTimeout(reconnectTimers.current[index]);
      reconnectTimers.current[index] = setTimeout(() => {
        console.log(`[Weighbridge Cam ${index + 1}] 🔄 Auto-reconnecting live stream...`);
        initHls(index, streamUrl);
      }, delayMs);
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 8000,
        fragLoadingTimeOut: 8000,
      });

      hlsInstances.current[index] = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        stopFeed(index);
        video.muted = true;
        video.play().catch(e => console.warn('Autoplay error:', e));
        setStreamStatuses(prev => ({ ...prev, [index]: 'connected' }));
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        stopFeed(index);
        setStreamStatuses(prev => prev[index] === 'connected' ? prev : ({ ...prev, [index]: 'connected' }));
      });

      video.onplaying = () => {
        stopFeed(index);
        setStreamStatuses(prev => ({ ...prev, [index]: 'connected' }));
      };

      video.onloadeddata = () => {
        stopFeed(index);
        setStreamStatuses(prev => ({ ...prev, [index]: 'connected' }));
      };

      video.oncanplay = () => {
        stopFeed(index);
        video.play().catch(() => {});
        setStreamStatuses(prev => ({ ...prev, [index]: 'connected' }));
      };

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setStreamStatuses(prev => ({ ...prev, [index]: 'standby' }));
          scheduleReconnect(5000);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = targetUrl;
      video.addEventListener('loadedmetadata', () => {
        video.muted = true;
        video.play().catch(() => {});
        setStreamStatuses(prev => ({ ...prev, [index]: 'connected' }));
      });
      video.addEventListener('error', () => {
        setStreamStatuses(prev => ({ ...prev, [index]: 'standby' }));
        scheduleReconnect(5000);
      });
    }
  }, [stopFeed]);

  // Mount & initialize all camera streams when cameras change or DB loads
  useEffect(() => {
    const timer = setTimeout(() => {
      cameras.forEach((cam, idx) => {
        initHls(idx, cam.hlsUrl);
      });
    }, 150);

    return () => {
      clearTimeout(timer);
      cameras.forEach((_, idx) => {
        if (reconnectTimers.current[idx]) {
          clearTimeout(reconnectTimers.current[idx]);
          reconnectTimers.current[idx] = null;
        }
        if (hlsInstances.current[idx]) {
          try {
            hlsInstances.current[idx]?.destroy();
          } catch (e) {}
          hlsInstances.current[idx] = null;
        }
      });
    };
  }, [cameras, initHls]);

  // Frame capture implementation with industrial metrology watermark stamp
  const captureFrame = useCallback((
    screenIndex: number,
    metadata?: { weight?: number; vehicleNo?: string; transactionNo?: number }
  ): string | null => {
    const cam = cameras[screenIndex] || cameras[0];
    const video = videoRefs.current[screenIndex];

    const targetW = 1280;
    const targetH = 720;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetW;
    exportCanvas.height = targetH;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return null;

    let drawn = false;
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      try {
        ctx.drawImage(video, 0, 0, targetW, targetH);
        drawn = true;
      } catch (e) {
        drawn = false;
      }
    }

    if (!drawn) {
      // Clean modern industrial background if camera stream frame not available
      const grad = ctx.createLinearGradient(0, 0, 0, targetH);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, targetW, targetH);

      // Grid watermark lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x < targetW; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, targetH);
        ctx.stroke();
      }
      for (let y = 0; y < targetH; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(targetW, y);
        ctx.stroke();
      }

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${cam.name.toUpperCase()} - LIVE SURVEILLANCE FEED`, targetW / 2, targetH / 2 - 20);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px monospace';
      ctx.fillText(`RTSP PROTOCOL: ${cam.ip}:554 | HLS 1080P REALTIME`, targetW / 2, targetH / 2 + 15);
    }

    // ====== INDUSTRIAL LEGAL METROLOGY WATERMARK STAMP ======
    const effectiveWeight = metadata?.weight !== undefined ? metadata.weight : currentWeight;
    const effectiveVehicle = metadata?.vehicleNo || vehicleRegNo || cam.plateSample;
    const effectiveTx = metadata?.transactionNo !== undefined ? metadata.transactionNo : transactionNo;
    const now = new Date();
    const timestampStr = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-GB', { hour12: false });

    // Top Header Banner
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(0, 0, targetW, 46);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, 44, targetW, 2);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(companyName.toUpperCase(), 20, 23);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`LEGAL METROLOGY SCALE LIC: ${weighbridgeLicense}`, targetW - 20, 23);

    // Bottom Detailed Metrics Banner
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(0, targetH - 58, targetW, 58);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, targetH - 58, targetW, 2);

    // Metric 1: Transaction & Timestamp
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`TX #${String(effectiveTx).padStart(5, '0')}  |  ${timestampStr}`, 20, targetH - 38);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(`CAMERA: ${cam.name} (${cam.angle.toUpperCase()})  ·  IP: ${cam.ip}`, 20, targetH - 18);

    // Metric 2: Vehicle & Verified Scale Weight
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`VEH: ${effectiveVehicle}`, targetW - 20, targetH - 38);

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`LATCHED SCALE WT: ${effectiveWeight.toLocaleString()} KG`, targetW - 20, targetH - 18);

    return exportCanvas.toDataURL('image/jpeg', 0.90);
  }, [cameras, companyName, currentWeight, transactionNo, vehicleRegNo, weighbridgeLicense]);

  // Imperative handle for parent to capture snapshots or get detected plate
  useImperativeHandle(ref, () => ({
    captureAllSnapshots: async (metadata) => {
      const results: Array<{
        camId: string;
        camName: string;
        angle: 'front' | 'side' | 'rear';
        dataUrl: string;
      }> = [];

      for (let i = 0; i < cameras.length; i++) {
        const dataUrl = captureFrame(i, metadata);
        if (dataUrl) {
          results.push({
            camId: cameras[i].id,
            camName: cameras[i].name,
            angle: cameras[i].angle,
            dataUrl,
          });
        }
      }
      return results;
    },
    captureSingleSnapshot: async (screenIndex: number, metadata) => {
      if (screenIndex < 0 || screenIndex >= cameras.length) return null;
      const dataUrl = captureFrame(screenIndex, metadata);
      if (!dataUrl) return null;
      return {
        camId: cameras[screenIndex].id,
        camName: cameras[screenIndex].name,
        angle: cameras[screenIndex].angle,
        dataUrl,
      };
    },
    fetchDetectedPlate: () => {
      return cameras[0]?.plateSample || vehicleRegNo || '';
    },
  }), [cameras, captureFrame]);

  // Extract up to 3 evidence thumbnails for the middle vertical stack
  const snap1 = evidenceList[0]?.url;
  const snap2 = evidenceList[1]?.url;
  const snap3 = evidenceList[2]?.url;

  return (
    <div className="flex gap-3 h-full">
      {/* 3-Slot Snapshot Stack */}
      <div className="flex flex-col gap-2.5 w-28 shrink-0">
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-center flex items-center justify-center gap-1.5 py-0.5">
          <Camera className="w-3.5 h-3.5 text-primary" />
          <span>Snapshots</span>
        </div>
        {[
          { label: 'Vehicle Evidence', url: snap1, angle: 'front' as const, screenIdx: 0 },
          { label: 'Front / ANPR', url: snap2, angle: 'side' as const, screenIdx: 1 },
          { label: 'Rear / Chute', url: snap3, angle: 'rear' as const, screenIdx: 0 },
        ].map((slot, idx) => (
          <div
            key={idx}
            className="flex-1 min-h-[96px] border-2 border-dashed border-border rounded-xl bg-card hover:bg-muted/40 hover:border-primary/50 flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer transition-all shadow-2xs"
            onClick={() => {
              if (slot.url) {
                setActivePreview(slot.url);
              } else if (onTakeSnapshot) {
                onTakeSnapshot(slot.angle);
              }
            }}
            title={slot.url ? `Click to view ${slot.label}` : `Click to capture ${slot.label}`}
          >
            {slot.url ? (
              <>
                <img
                  src={slot.url}
                  alt={slot.label}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
                <span className="absolute bottom-0 inset-x-0 bg-background/90 backdrop-blur-xs text-[9px] text-foreground text-center py-0.5 font-mono flex items-center justify-center gap-1 border-t border-border">
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                  {slot.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onTakeSnapshot) onTakeSnapshot(slot.angle);
                  }}
                  className="absolute top-1.5 right-1.5 p-1 bg-background/80 hover:bg-primary text-foreground hover:text-primary-foreground rounded-md opacity-0 group-hover:opacity-100 transition-all shadow-xs"
                  title="Retake snapshot"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center p-2 text-muted-foreground group-hover:text-primary transition-colors text-center">
                <Camera className="w-5 h-5 mb-1.5 opacity-60 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-semibold leading-tight">
                  {slot.label}
                </span>
                <span className="text-[8px] text-muted-foreground/80 mt-0.5 font-mono">
                  Slot #{idx + 1}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Live Video Feeds (All Active Cameras: 1, 2 & 3) */}
      <div className="flex flex-col gap-3 flex-1 min-w-[300px] overflow-y-auto max-h-[calc(100vh-220px)] pr-1">
        {cameras.map((cam, idx) => (
          <div
            key={cam.id}
            className="border border-border rounded-xl bg-card overflow-hidden shadow-xs flex flex-col"
          >
            {/* Header: Camera Name + Live Status */}
            <div className="bg-muted/50 px-3 py-1.5 flex items-center justify-between text-xs font-semibold text-foreground border-b border-border">
              <div className="flex items-center gap-2">
                <Camera className="w-3.5 h-3.5 text-primary" />
                {availableCameras.length > 0 ? (
                  <select
                    value={cam.id}
                    onChange={(e) => handleSelectCamera(idx, e.target.value)}
                    className="bg-card text-foreground text-xs font-semibold rounded px-1.5 py-0.5 border border-border/80 hover:border-primary focus:outline-hidden cursor-pointer"
                    title="Select camera feed for this viewport"
                  >
                    {availableCameras.map(c => (
                      <option key={c.device_id || c.id} value={c.device_id || c.id} className="bg-card text-foreground">
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-semibold">{cam.name}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                {streamStatuses[idx] === 'connected' ? (
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Live 1080P</span>
                  </span>
                ) : streamStatuses[idx] === 'connecting' ? (
                  <span className="flex items-center gap-1.5 text-amber-500 font-medium">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    <span>Connecting...</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-rose-500 font-medium">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>Offline</span>
                  </span>
                )}
              </div>
            </div>

            {/* Viewport Screen */}
            <div className="relative aspect-[16/10] bg-neutral-950 flex items-center justify-center overflow-hidden">
              {/* HTML5 Video element for physical HLS stream or live canvas stream */}
              <video
                ref={el => { videoRefs.current[idx] = el; }}
                className={`absolute inset-0 w-full h-full object-cover z-0 ${streamStatuses[idx] === 'connected' ? 'block' : 'hidden'}`}
                playsInline
                muted
                autoPlay
              />

              {/* Connecting Overlay */}
              {streamStatuses[idx] === 'connecting' && (
                <div className="absolute inset-0 bg-neutral-950 flex flex-col items-center justify-center p-4 text-center z-5 text-white">
                  <RefreshCw className="w-6 h-6 text-primary animate-spin mb-2" />
                  <span className="text-xs text-white/80 font-mono">Connecting to {cam.name}...</span>
                  <span className="text-[10px] text-neutral-400 font-mono mt-0.5">{cam.ip}:554</span>
                </div>
              )}

              {/* Standby / Offline Overlay */}
              {streamStatuses[idx] === 'standby' && (
                <div className="absolute inset-0 bg-neutral-950 flex flex-col items-center justify-center p-4 text-center z-5 text-white">
                  <Camera className="w-6 h-6 text-rose-400 mb-2" />
                  <span className="text-xs text-white/90 font-mono font-medium">Camera Signal Offline</span>
                  <span className="text-[10px] text-neutral-400 font-mono mt-0.5">{cam.ip}:554 • Auto-reconnecting...</span>
                </div>
              )}

              {/* Grid overlay for alignment */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:2rem_2rem] pointer-events-none z-10" />

              {/* Top HUD Badges */}
              <div className="absolute top-2 left-2 z-20 font-mono text-[10px] text-white/90 bg-neutral-900/80 backdrop-blur-xs px-2 py-0.5 rounded-md border border-white/10 flex items-center gap-1.5 shadow-xs">
                <span className="font-bold text-sky-400">CAM 0{idx + 1}</span>
                <span className="text-neutral-500">•</span>
                <span>3 FPS</span>
                <span className="text-neutral-500">•</span>
                <span>1080P</span>
              </div>



              {/* Camera 1 ANPR Interactive Tag & Auto-Fetch Button */}
              {idx === 0 && (
                <div className="absolute bottom-2 left-2 z-20 flex items-center gap-2">
                  {vehicleRegNo || cam.plateSample ? (
                    <button
                      type="button"
                      onClick={() => {
                        const detected = cam.plateSample || vehicleRegNo;
                        if (detected && onPlateDetected) onPlateDetected(detected);
                      }}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50 px-2.5 py-1 rounded-md shadow-sm transition-all active:scale-95 flex items-center gap-1.5 text-xs font-mono font-bold"
                      title="Click to apply detected plate to Vehicle No"
                    >
                      <Scan className="w-3.5 h-3.5 text-white animate-pulse" />
                      <span>ANPR: {vehicleRegNo || cam.plateSample}</span>
                      <span className="text-[10px] bg-white/20 px-1 py-0.2 rounded uppercase">Apply</span>
                    </button>
                  ) : (
                    <div
                      className="bg-neutral-900/80 text-white/70 border border-white/10 px-2.5 py-1 rounded-md shadow-sm flex items-center gap-1.5 text-xs font-mono"
                      title="ANPR Camera Active - Waiting for vehicle"
                    >
                      <Scan className="w-3.5 h-3.5 text-white/50" />
                      <span>ANPR: Standby</span>
                    </div>
                  )}
                </div>
              )}

              {/* Manual Snap quick button on viewport */}
              <button
                type="button"
                onClick={() => {
                  if (onTakeSnapshot) onTakeSnapshot(cam.angle);
                }}
                className="absolute bottom-2 right-2 z-20 bg-neutral-900/80 hover:bg-primary text-white px-2.5 py-1 rounded-md text-[11px] font-mono flex items-center gap-1.5 border border-white/10 transition-colors shadow-xs"
                title={`Capture ${cam.name} Snapshot`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Snap</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Snapshot Fullscreen Preview Modal */}
      {activePreview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setActivePreview(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-card border border-border rounded-xl overflow-hidden shadow-2xl">
            <div className="bg-muted px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-foreground border-b border-border">
              <span className="font-bold flex items-center gap-2">
                <Camera className="w-4 h-4 text-primary" />
                <span>Captured Evidence Snapshot (Legal Metrology Format)</span>
              </span>
              <button
                type="button"
                onClick={() => setActivePreview(null)}
                className="text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md text-xs bg-muted/80 hover:bg-muted font-medium transition-colors"
              >
                Close (ESC)
              </button>
            </div>
            <div className="p-3 bg-neutral-950 flex items-center justify-center">
              <img
                src={activePreview}
                alt="Captured Snapshot Preview"
                className="max-h-[75vh] w-auto object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

DualCameraFeedPanel.displayName = 'DualCameraFeedPanel';

export default DualCameraFeedPanel;
