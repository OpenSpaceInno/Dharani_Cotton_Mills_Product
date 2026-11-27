import { useEffect, useState, useRef, useCallback } from "react";
import { CameraFeed } from "@/types/anpr";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Camera,
  Wifi,
  WifiOff,
  AlertCircle,
  Settings,
  Maximize2,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Video,
  Radio,
  Play,
  Tv,
  Activity,
  CheckCircle2,
  XCircle,
  HelpCircle
} from "lucide-react";
import { api } from "@/lib/api";
import { RTSPConfig } from "@/types/deviceConfig";
import Hls from 'hls.js';
import { LiveANPRDetector } from "./LiveANPRDetector";
import { useSimulatedFeed } from "./useSimulatedFeed";
import { toast } from "sonner";

interface LiveFeedViewerProps {
  camera: CameraFeed;
  showControls?: boolean;
  enableANPR?: boolean;
  onPlateDetected?: (plate: string, confidence: number, imageUrl?: string) => void;
  onRegisterCapture?: (captureFunc: () => void) => void;
}

export function LiveFeedViewer({
  camera,
  showControls = true,
  enableANPR = false,
  onPlateDetected,
  onRegisterCapture
}: LiveFeedViewerProps) {
  const [rtspConfig, setRtspConfig] = useState<RTSPConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('connecting');
  const [reconnectCount, setReconnectCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  // Diagnostic state
  const [checkingDiag, setCheckingDiag] = useState(false);
  const [diagResult, setDiagResult] = useState<{
    ip: string;
    reachable: boolean;
    ports: { '554': boolean; '80': boolean; '8000': boolean };
    message: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reconnectTimerRef = useRef<any>(null);

  const cameraIp = camera.ip_address || camera.ipAddress || (camera as any).ip || '';
  const laneType = camera.location?.toLowerCase().includes('exit') ? 'exit' : 'entry';

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Helper to ensure valid HLS playlist URL
  const normalizeStreamUrl = useCallback((url?: string) => {
    let u = (url || '').trim();
    const idLower = (camera.id || '').toLowerCase();
    const nameLower = (camera.name || '').toLowerCase();
    const defaultSlug = (idLower.includes('3') || idLower.includes('gate_3') || nameLower.includes('3') || nameLower.includes('platform 2') || idLower.includes('rear'))
      ? 'cam3'
      : (idLower.includes('scale') || idLower.includes('gate_2') || idLower.includes('gate_4') || idLower.includes('2') || nameLower.includes('2'))
        ? 'cam2'
        : 'cam1';

    if (u.includes(':8888/')) {
      const slug = u.split(':8888/')[1].replace(/\/+$/, '').replace(/\/index\.m3u8$/, '');
      return `/hls/${slug || defaultSlug}/index.m3u8`;
    }
    if (!u) return `/hls/${defaultSlug}/index.m3u8`;
    while (u.endsWith('/')) u = u.slice(0, -1);
    if (!u.endsWith('.m3u8')) u = `${u}/index.m3u8`;
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    return u.startsWith('/') ? u : `/${u}`;
  }, [camera.id, camera.name]);

  // Load RTSP configuration from backend API
  const loadOrCreateRTSPConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getRTSPConfig(camera.id);

      const dynamicDirectUrl = camera.direct_url || camera.rtsp_url ||
        (cameraIp ? `rtsp://admin:Password@123@${cameraIp}:554/Streaming/Channels/102` : '');
      const dynamicHlsUrl = normalizeStreamUrl(camera.hls_proxy_url);

      if (data && !data.error) {
        const config: RTSPConfig = {
          enabled: Boolean(data.enabled),
          url: data.url || dynamicDirectUrl,
          directUrl: data.direct_url || dynamicDirectUrl,
          useDirectUrl: Boolean(data.use_direct_url),
          port: data.port || 554,
          username: data.username || 'admin',
          password: data.password || 'Password@123',
          streamPath: data.stream_path || '/Streaming/Channels/102',
          transport: (data.transport as 'tcp' | 'udp') || 'tcp',
          reconnectInterval: data.reconnect_interval || 5,
          bufferSize: data.buffer_size || 1024,
          lowLatencyMode: Boolean(data.low_latency_mode),
          hlsProxyUrl: normalizeStreamUrl(data.hls_proxy_url || dynamicHlsUrl),
        };
        setRtspConfig(config);
      } else {
        const defaultConfig: RTSPConfig = {
          enabled: true,
          url: dynamicDirectUrl,
          directUrl: dynamicDirectUrl,
          useDirectUrl: true,
          port: 554,
          username: 'admin',
          password: 'Password@123',
          streamPath: '/Streaming/Channels/102',
          transport: 'tcp',
          reconnectInterval: 5,
          bufferSize: 1024,
          lowLatencyMode: true,
          hlsProxyUrl: dynamicHlsUrl,
        };
        setRtspConfig(defaultConfig);
      }
    } catch (err) {
      const dynamicDirectUrl = camera.direct_url || camera.rtsp_url ||
        (cameraIp ? `rtsp://admin:Password@123@${cameraIp}:554/Streaming/Channels/102` : '');
      const dynamicHlsUrl = normalizeStreamUrl(camera.hls_proxy_url);

      setRtspConfig({
        enabled: true,
        url: dynamicDirectUrl,
        directUrl: dynamicDirectUrl,
        useDirectUrl: true,
        port: 554,
        username: 'admin',
        password: 'Password@123',
        streamPath: '/Streaming/Channels/102',
        transport: 'tcp',
        reconnectInterval: 5,
        bufferSize: 1024,
        lowLatencyMode: true,
        hlsProxyUrl: dynamicHlsUrl,
      });
    } finally {
      setLoading(false);
    }
  }, [camera.id, cameraIp, camera.direct_url, camera.rtsp_url, camera.hls_proxy_url, normalizeStreamUrl]);

  useEffect(() => {
    loadOrCreateRTSPConfig();
  }, [loadOrCreateRTSPConfig]);

  // Connect HLS Stream (with resilient auto-reconnect without refresh)
  const connectHlsStream = useCallback(() => {
    if (!rtspConfig?.hlsProxyUrl || !videoRef.current) return;

    const video = videoRef.current;
    if (video.srcObject) {
      video.srcObject = null;
    }
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.playsInline = true;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch (_) {}
      hlsRef.current = null;
    }

    setStreamStatus(prev => prev === 'connected' ? prev : 'connecting');

    const scheduleReconnect = (delayMs = 5000) => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connectHlsStream();
      }, delayMs);
    };

    const targetUrl = rtspConfig.hlsProxyUrl;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 1500,
        levelLoadingTimeOut: 6000,
        fragLoadingTimeOut: 6000,
      });

      hlsRef.current = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log(`[${camera.id}] ✅ HLS manifest parsed successfully`);
        setStreamStatus('connected');
        video.muted = true;
        video.play().catch(e => console.warn('Autoplay error:', e));
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        setStreamStatus('connected');
      });

      video.onplaying = () => {
        setStreamStatus('connected');
      };

      video.onloadeddata = () => {
        setStreamStatus('connected');
      };

      video.oncanplay = () => {
        video.play().catch(() => {});
        setStreamStatus('connected');
      };

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn(`[${camera.id}] HLS network error (${data.details}), retrying startLoad...`);
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn(`[${camera.id}] HLS media error (${data.details}), recovering...`);
              hls.recoverMediaError();
              break;
            default:
              console.warn(`[${camera.id}] Fatal HLS stream error (${data.details}), retrying...`);
              setStreamStatus('error');
              scheduleReconnect(3000);
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = targetUrl;
      video.addEventListener('loadedmetadata', () => {
        setStreamStatus('connected');
        video.play().catch(e => console.warn('Safari autoplay error:', e));
      });
      video.addEventListener('error', () => {
        setStreamStatus('error');
        scheduleReconnect(5000);
      });
    }
  }, [rtspConfig?.hlsProxyUrl, camera.id]);

  useEffect(() => {
    connectHlsStream();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch (_) {}
        hlsRef.current = null;
      }
    };
  }, [rtspConfig?.hlsProxyUrl, reconnectCount, connectHlsStream]);

  // Switch back to Physical RTSP stream
  const handleSwitchToRTSP = () => {
    setStreamStatus('connecting');
    setReconnectCount(prev => prev + 1);
    connectHlsStream();
    toast.info(`Connecting to Physical RTSP stream at ${cameraIp}...`);
  };

  // Run hardware socket diagnostic
  const handleRunDiagnostic = async () => {
    setCheckingDiag(true);
    try {
      const res = await api.checkCameraDiagnostic(cameraIp);
      setDiagResult(res);
      if (res.reachable) {
        toast.success(`Camera at ${cameraIp} is responsive!`);
      } else {
        toast.error(`Camera at ${cameraIp} is unreachable on this subnet.`);
      }
    } catch (err: any) {
      toast.error('Diagnostic error: ' + (err.message || 'Failed'));
    } finally {
      setCheckingDiag(false);
    }
  };

  const getRtspUrl = () => {
    if (rtspConfig?.directUrl) return rtspConfig.directUrl;
    return `rtsp://admin:Password@123@${cameraIp}:554/Streaming/Channels/101`;
  };

  const copyRtspUrl = () => {
    navigator.clipboard.writeText(getRtspUrl());
    setCopied(true);
    toast.success('RTSP Stream URL copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const openInVLC = () => {
    window.open(`vlc://${getRtspUrl()}`, '_blank');
  };

  const openCameraWeb = () => {
    window.open(`http://${cameraIp}`, '_blank');
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  // Test plate OCR trigger
  const handleSimulatePlate = () => {
    const testPlates = [
      { plate: "MH 12 RN 4501", conf: 0.98 },
      { plate: "KA 04 MM 9123", conf: 0.96 },
      { plate: "MH 14 EM 8821", conf: 0.95 },
      { plate: "MH 12 QX 9901", conf: 0.97 },
    ];
    const picked = testPlates[Math.floor(Math.random() * testPlates.length)];
    onPlateDetected?.(picked.plate, picked.conf);
    toast.success(`ANPR Plate Captured: ${picked.plate} (${(picked.conf * 100).toFixed(0)}%)`);
  };

  const isVideoLive = streamStatus === 'connected';

  return (
    <Card className="overflow-hidden border-border/80 shadow-md flex flex-col justify-between">
      <CardHeader className="pb-3 bg-card/60 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${streamStatus === 'connected' ? 'text-emerald-500 animate-pulse' : (streamStatus === 'connecting' ? 'text-amber-500' : 'text-muted-foreground')}`} />
            <CardTitle className="text-base font-semibold">{camera.name}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {streamStatus === 'connected' ? (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1 font-mono">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                RTSP LIVE
              </Badge>
            ) : streamStatus === 'connecting' ? (
              <Badge variant="outline" className="border-amber-500/30 text-amber-400 gap-1 font-mono">
                <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
                CONNECTING
              </Badge>
            ) : (
              <Badge variant="outline" className="border-rose-500/30 text-rose-400 gap-1 font-mono">
                <span className="h-2 w-2 rounded-full bg-rose-500 mr-1" />
                OFFLINE
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 flex flex-col justify-between bg-black">
        <div ref={containerRef} className="aspect-video bg-neutral-950 relative group overflow-hidden flex items-center justify-center">
          {/* Main Video Element */}
          <video
            ref={videoRef}
            className={`w-full h-full object-contain bg-black ${isVideoLive ? 'block' : 'hidden'}`}
            autoPlay
            muted
            playsInline
            controls={false}
          />

          {/* Connected Live HUD */}
          {isVideoLive && (
            <>
              {/* Top HUD */}
              <div className="absolute top-2 left-2 text-white/90 font-mono text-xs bg-black/70 backdrop-blur-sm px-2.5 py-1 rounded flex items-center gap-2 pointer-events-none">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{camera.name}</span>
                <span>•</span>
                <span>LIVE</span>
                <span>•</span>
                <span>{currentTime}</span>
              </div>

              {/* Background ANPR frame capture (no overlay UI) */}
              {enableANPR && onPlateDetected && (
                <LiveANPRDetector
                  cameraId={camera.id}
                  videoElement={videoRef.current}
                  onPlateDetected={onPlateDetected}
                  enabled={isVideoLive}
                  onRegisterCapture={onRegisterCapture}
                />
              )}
            </>
          )}

          {/* Standby / Error / Connecting Overlay */}
          {!isVideoLive && (
            <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900 p-5 flex flex-col justify-between text-white">
              {/* Header Info */}
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-primary" />
                  <span className="font-mono">{camera.name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {streamStatus === 'connecting' ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
                      <span className="font-mono text-amber-400">CONNECTING...</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3 text-rose-400" />
                      <span className="font-mono text-rose-400 uppercase">SIGNAL OFFLINE</span>
                    </>
                  )}
                </div>
              </div>

              {/* Center Panel */}
              <div className="text-center space-y-3 my-auto max-w-md mx-auto">
                <div className="p-3 rounded-full bg-neutral-800/80 border border-neutral-700 w-fit mx-auto">
                  {streamStatus === 'connecting' ? (
                    <RefreshCw className="h-7 w-7 text-primary animate-spin" />
                  ) : (
                    <Video className="h-7 w-7 text-rose-400" />
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold tracking-wide text-neutral-100">
                    {streamStatus === 'connecting' ? 'Negotiating RTSP Live Stream...' : 'Camera Signal Offline'}
                  </h4>
                  <p className="text-xs text-neutral-400 mt-1 font-mono">
                    {cameraIp ? `IP: ${cameraIp}:554 • Auto-reconnecting live stream...` : 'Waiting for camera configuration...'}
                  </p>
                </div>

                {/* Diagnostic feedback if checked */}
                {diagResult && (
                  <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-left space-y-1 font-mono">
                    <p className="text-neutral-300 font-semibold flex items-center justify-between">
                      <span>Network Reachability ({diagResult.ip}):</span>
                      <span className={diagResult.reachable ? "text-emerald-400" : "text-rose-400"}>
                        {diagResult.reachable ? "ONLINE" : "UNREACHABLE"}
                      </span>
                    </p>
                    <div className="grid grid-cols-3 gap-1 text-[11px] pt-1">
                      <span className={diagResult.ports['554'] ? "text-emerald-400" : "text-neutral-500"}>
                        Port 554 (RTSP): {diagResult.ports['554'] ? 'OPEN' : 'CLOSED'}
                      </span>
                      <span className={diagResult.ports['80'] ? "text-emerald-400" : "text-neutral-500"}>
                        Port 80 (Web): {diagResult.ports['80'] ? 'OPEN' : 'CLOSED'}
                      </span>
                      <span className={diagResult.ports['8000'] ? "text-emerald-400" : "text-neutral-500"}>
                        Port 8000: {diagResult.ports['8000'] ? 'OPEN' : 'CLOSED'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Simplified Operator Quick Controls */}
              <div className="flex items-center justify-center gap-2 pt-2 border-t border-neutral-800">
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 text-xs gap-1.5 px-4"
                  onClick={handleSwitchToRTSP}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry Connection
                </Button>
              </div>
            </div>
          )}

          {/* Fullscreen Button */}
          {showControls && (
            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 z-20">
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7 bg-black/70 hover:bg-black text-white"
                onClick={toggleFullscreen}
                title="Fullscreen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
