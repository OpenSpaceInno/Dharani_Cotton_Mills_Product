import React, { useState, useEffect } from 'react';
import { Camera, Plus, RefreshCw, Trash2, Edit3, Activity, CheckCircle, XCircle, AlertCircle, Eye, EyeOff, Radio, ExternalLink, Key, Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CameraDevice } from '@/types/deviceConfig';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const CameraManager: React.FC = () => {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { reachable: boolean; message: string; ports?: any }>>({});
  const [testingRtsp, setTestingRtsp] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [rtspTestResult, setRtspTestResult] = useState<{ success: boolean; status: string; message: string } | null>(null);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<CameraDevice | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    device_id: '',
    name: '',
    model: 'Hikvision ANPR Bullet',
    location: 'Main Inbound Gate',
    ip_address: '',
    rtsp_url: '',
    port: 554,
    username: 'admin',
    password: 'Password@123',
    stream_path: '/Streaming/Channels/102',
    status: 'online',
  });

  const buildRtspUrl = (user: string, pass: string, ip: string, port: number | string, path: string) => {
    if (!ip) return '';
    const cleanIp = ip.includes('@') ? ip.split('@').pop()?.trim() || '' : ip.trim();
    const resolvedUser = user || 'admin';
    const resolvedPass = (pass && pass !== '••••••••') ? pass : 'Password@123';
    const creds = `${resolvedUser}:${resolvedPass}@`;
    const portStr = port && Number(port) !== 554 ? `:${port}` : ':554';
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `rtsp://${creds}${cleanIp}${portStr}${cleanPath}`;
  };

  const fetchCameras = async () => {
    try {
      setLoading(true);
      const data = await api.getCameras();
      const cleanList = (Array.isArray(data) ? data : []).map((cam: any) => ({
        ...cam,
        ip_address: (cam.ip_address || '').includes('@') ? cam.ip_address.split('@').pop() : cam.ip_address
      }));
      setCameras(cleanList);
    } catch (err: any) {
      toast.error('Failed to load camera devices: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handleOpenAdd = () => {
    setEditingCamera(null);
    setShowPassword(false);
    setRtspTestResult(null);
    const nextNum = cameras.length + 1;
    const defaultIp = nextNum === 1 ? '192.168.10.201' : (nextNum === 2 ? '192.168.10.202' : `192.168.10.20${nextNum}`);
    const defaultStream = '/Streaming/Channels/102';
    const defaultUser = 'admin';
    const defaultPass = 'Password@123';

    setFormData({
      device_id: `cam_gate_${nextNum}`,
      name: `Camera ${nextNum}`,
      model: nextNum === 1 ? 'Hikvision ANPR Bullet' : 'Hikvision Overview Camera',
      location: nextNum === 1 ? 'Gate Entry Lane' : 'Weighbridge Platform',
      ip_address: defaultIp,
      rtsp_url: buildRtspUrl(defaultUser, defaultPass, defaultIp, 554, defaultStream),
      port: 554,
      username: defaultUser,
      password: defaultPass,
      stream_path: defaultStream,
      status: 'online',
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = async (cam: CameraDevice) => {
    setEditingCamera(cam);
    setShowPassword(false);
    setRtspTestResult(null);
    const targetDevId = cam.device_id || (cam as any).deviceId || (cam as any).id || '';
    const rawIp = cam.ip_address || '';
    const cleanIp = rawIp.includes('@') ? rawIp.split('@').pop()?.trim() || '' : rawIp.trim();
    let rtsp: any = null;
    try {
      rtsp = await api.getRTSPConfig(targetDevId);
    } catch { }

    const user = rtsp?.username || 'admin';
    const pass = rtsp?.password || 'Password@123';
    const port = rtsp?.port || 554;
    const stream = rtsp?.stream_path || '/Streaming/Channels/102';
    const existingRtsp = rtsp?.direct_url || rtsp?.url || (cam as any).direct_url || (cam as any).rtsp_url;

    setFormData({
      device_id: targetDevId,
      name: cam.name || '',
      model: cam.model || 'Hikvision ANPR Bullet',
      location: cam.location || 'Main Gate',
      ip_address: cleanIp,
      rtsp_url: existingRtsp || buildRtspUrl(user, pass, cleanIp, port, stream),
      port: port,
      username: user,
      password: pass,
      stream_path: stream,
      status: cam.status || 'online',
    });
    setIsDialogOpen(true);
  };

  const handleTestRtsp = async () => {
    const rawIp = formData.ip_address.trim();
    const cleanIp = rawIp.includes('@') ? rawIp.split('@').pop()?.trim() || '' : rawIp;
    if (!cleanIp) {
      toast.error('Please enter a valid camera IP address first.');
      return;
    }
    setTestingRtsp(true);
    setRtspTestResult(null);
    try {
      const res = await api.testRtspStream({
        ip: cleanIp,
        port: Number(formData.port) || 554,
        username: formData.username,
        password: formData.password,
        stream_path: formData.stream_path,
      });
      setRtspTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to connect to camera RTSP port';
      setRtspTestResult({ success: false, status: 'error', message: msg });
      toast.error(msg);
    } finally {
      setTestingRtsp(false);
    }
  };

  const handleAutoDetectInModal = async () => {
    const rawIp = formData.ip_address.trim();
    const cleanIp = rawIp.includes('@') ? rawIp.split('@').pop()?.trim() || '' : rawIp;
    if (!cleanIp) {
      toast.error('Please enter a valid camera IP address first.');
      return;
    }
    setIsAutoDetecting(true);
    setRtspTestResult(null);
    toast.info(`Scanning RTSP stream paths on ${cleanIp}...`);
    try {
      const res = await api.autoDetectCameraStream({
        device_id: formData.device_id,
        ip: cleanIp,
        username: formData.username,
        password: formData.password,
        auto_apply: false
      });
      if (res && res.success) {
        setFormData(prev => ({
          ...prev,
          stream_path: res.matched_path,
          port: res.matched_port,
          rtsp_url: res.direct_url
        }));
        setRtspTestResult({
          success: true,
          status: res.match.status,
          message: res.message
        });
        toast.success(res.message);
      } else {
        toast.error('Could not auto-detect camera stream. Please check camera network or credentials.');
      }
    } catch (err: any) {
      toast.error('Auto-detect error: ' + (err.message || 'Failed'));
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const notifyCameraSync = () => {
    try {
      const ch = new BroadcastChannel('rmc_camera_sync');
      ch.postMessage({ type: 'CAMERA_CONFIG_CHANGED', timestamp: Date.now() });
      ch.close();
    } catch (e) { }
    window.dispatchEvent(new CustomEvent('rmc_camera_sync'));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = formData.device_id.trim();
    const rawIp = formData.ip_address.trim();
    const cleanIp = rawIp.includes('@') ? rawIp.split('@').pop()?.trim() || '' : rawIp;
    if (!targetId || !formData.name || !cleanIp) {
      toast.error('Please enter Camera ID, Name, and valid IP address.');
      return;
    }

    // Determine correct HLS stream slug
    const devIdLower = targetId.toLowerCase();
    const nameLower = formData.name.toLowerCase();
    const slug = (devIdLower.includes('3') || devIdLower.includes('gate_3') || nameLower.includes('camera 3') || nameLower.includes('platform 2') || devIdLower.includes('rear') || nameLower.includes('rear'))
      ? 'cam3'
      : (devIdLower.includes('scale') || devIdLower.includes('gate_2') || devIdLower.includes('gate_4') || devIdLower.includes('2') || nameLower.includes('camera 2') || nameLower.includes('overhead'))
        ? 'cam2'
        : 'cam1';
    const hlsProxyUrl = `http://localhost:8888/${slug}/index.m3u8`;

    // Ensure RTSP URL reflects latest IP address and credentials
    let effectiveRtsp = formData.rtsp_url.trim();
    if (!effectiveRtsp || !effectiveRtsp.includes(cleanIp)) {
      effectiveRtsp = buildRtspUrl(formData.username, formData.password, cleanIp, formData.port, formData.stream_path);
    }

    const cameraPayload = {
      device_id: targetId,
      deviceId: targetId,
      name: formData.name.trim(),
      model: formData.model.trim(),
      location: formData.location.trim(),
      ip_address: cleanIp,
      status: formData.status,
      rtsp_url: effectiveRtsp,
      direct_url: effectiveRtsp,
      directUrl: effectiveRtsp,
      hls_proxy_url: hlsProxyUrl,
      hlsProxyUrl: hlsProxyUrl,
      port: Number(formData.port) || 554,
      username: formData.username || 'admin',
      password: formData.password || '',
      stream_path: formData.stream_path || '/ch1/main/av_stream',
    };

    const rtspPayload = {
      device_id: targetId,
      deviceId: targetId,
      url: effectiveRtsp,
      direct_url: effectiveRtsp,
      directUrl: effectiveRtsp,
      use_direct_url: true,
      useDirectUrl: true,
      port: Number(formData.port) || 554,
      username: formData.username || 'admin',
      password: formData.password || '',
      stream_path: formData.stream_path || '/ch1/main/av_stream',
      hls_proxy_url: hlsProxyUrl,
      enabled: true,
    };

    const networkPayload = {
      device_id: targetId,
      deviceId: targetId,
      ip_address: cleanIp,
      ipAddress: cleanIp,
      subnet_mask: '255.255.255.0',
      gateway: '192.168.10.1',
      primary_dns: '8.8.8.8',
      secondary_dns: '8.8.4.4',
      dhcp_enabled: false,
    };

    try {
      if (editingCamera) {
        const originalId = editingCamera.device_id || (editingCamera as any).deviceId || editingCamera.id || targetId;
        await api.updateCamera(originalId, cameraPayload);
        await api.saveRTSPConfig(rtspPayload).catch(() => { });
        await api.saveNetworkConfig(networkPayload).catch(() => { });
        toast.success(`Camera "${formData.name}" updated with IP ${cleanIp} and persisted to database!`);
      } else {
        await api.createCamera(cameraPayload);
        await api.saveRTSPConfig(rtspPayload).catch(() => { });
        await api.saveNetworkConfig(networkPayload).catch(() => { });
        toast.success(`New camera "${formData.name}" registered and saved to database!`);
      }
      setIsDialogOpen(false);
      await fetchCameras();
      notifyCameraSync();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save camera.');
    }
  };

  const handleDelete = async (deviceId: string, name: string) => {
  if (!confirm(`Are you sure you want to remove camera "${name}" (${deviceId})?`)) return;
  try {
    await api.deleteCamera(deviceId);
    toast.success(`Camera ${name} deleted successfully.`);
    await fetchCameras();
    notifyCameraSync();
  } catch (err: any) {
    toast.error(err.message || 'Failed to delete camera.');
  }
};

const handleTestDiagnostic = async (cam: CameraDevice) => {
  try {
    setTestingId(cam.device_id);
    const res = await api.checkCameraDiagnostic(cam.ip_address);
    setTestResults(prev => ({
      ...prev,
      [cam.device_id]: {
        reachable: res.reachable,
        message: res.message,
        ports: res.ports,
      }
    }));
    if (res.reachable) {
      toast.success(`Camera at ${cam.ip_address} is online!`);
    } else {
      toast.warning(`Camera at ${cam.ip_address} timed out.`);
    }
  } catch (err: any) {
    setTestResults(prev => ({
      ...prev,
      [cam.device_id]: {
        reachable: false,
        message: err.message,
      }
    }));
    toast.error('Diagnostic probe failed: ' + err.message);
  } finally {
    setTestingId(null);
  }
};

return (
  <div className="space-y-4">
    {/* Action Header */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card p-4 rounded-xl border border-border">
      <div>
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          ANPR & Overhead CCTV Surveillance Cameras
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure IP cameras, RTSP video streams, network diagnostic pings, and gate locations.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={fetchCameras} disabled={loading} className="text-xs">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button size="sm" onClick={handleOpenAdd} className="text-xs">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Camera
        </Button>
      </div>
    </div>

    {/* Grid of Cameras */}
    {loading && cameras.length === 0 ? (
      <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading cameras...
      </div>
    ) : cameras.length === 0 ? (
      <Card className="p-8 text-center border-dashed">
        <p className="text-sm text-muted-foreground mb-3">No camera devices configured yet.</p>
        <Button size="sm" onClick={handleOpenAdd}>
          <Plus className="h-4 w-4 mr-1.5" /> Register First Camera
        </Button>
      </Card>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
        {cameras.map((cam) => {
          const diag = testResults[cam.device_id];
          const isTesting = testingId === cam.device_id;

          return (
            <Card key={cam.device_id} className="border-border hover:border-primary/40 transition-all flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                      <Camera className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-foreground leading-tight flex items-center gap-2">
                        {cam.name}
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                          {cam.device_id}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">{cam.model || 'IP Camera'}</CardDescription>
                    </div>
                  </div>

                  <Badge
                    className={
                      cam.status === 'online'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[11px]'
                        : 'bg-muted text-muted-foreground text-[11px]'
                    }
                  >
                    {cam.status.toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-3 pt-0">
                <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/50">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground block">IP Address</span>
                    <span className="font-mono font-medium text-foreground">
                      {(cam.ip_address || '').includes('@') ? (cam.ip_address || '').split('@').pop()?.trim() : (cam.ip_address || 'Unconfigured')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Location</span>
                    <span className="font-medium text-foreground">{cam.location}</span>
                  </div>
                </div>

                {/* Diagnostic Probe Result Banner */}
                {diag && (
                  <div
                    className={`text-xs p-2 rounded flex items-center gap-2 ${diag.reachable
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : 'bg-destructive/10 text-destructive border border-destructive/20'
                      }`}
                  >
                    {diag.reachable ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{diag.message}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestDiagnostic(cam)}
                    disabled={isTesting}
                    className="text-xs h-8"
                  >
                    <Activity className={`h-3.5 w-3.5 mr-1.5 ${isTesting ? 'animate-spin text-primary' : 'text-primary'}`} />
                    {isTesting ? 'Testing...' : 'Ping Test'}
                  </Button>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(cam)}
                      className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(cam.device_id || (cam as any).id, cam.name)}
                      className="h-8 px-2.5 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    )}

    {/* Add / Edit Camera Modal */}
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              {editingCamera ? 'Edit Camera Configuration' : 'Register New Camera'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Set IP address, location, and RTSP direct stream parameters.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Device Code</Label>
                <Input
                  placeholder="e.g. cam_gate_1"
                  value={formData.device_id}
                  disabled={!!editingCamera}
                  onChange={(e) => setFormData({ ...formData, device_id: e.target.value })}
                  required
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Camera Name</Label>
                <Input
                  placeholder="e.g. Main Inbound Gate"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">IP Address</Label>
                <Input
                  placeholder="192.168.0.101"
                  value={formData.ip_address}
                  onChange={(e) => {
                    const newIp = e.target.value;
                    setFormData(prev => ({
                      ...prev,
                      ip_address: newIp,
                      rtsp_url: buildRtspUrl(prev.username, prev.password, newIp, prev.port, prev.stream_path)
                    }));
                  }}
                  required
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Location</Label>
                <Input
                  placeholder="e.g. Weighbridge Platform"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Camera Model</Label>
                <Input
                  placeholder="Hikvision / GeoVision"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Operating Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(val) => setFormData({ ...formData, status: val })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                    <SelectItem value="standby">Standby</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* RTSP Credentials & Port */}
            <div className="p-2.5 rounded-md bg-muted/30 border space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[11px] text-foreground flex items-center gap-1.5">
                  <Key className="h-3 w-3 text-primary" /> RTSP Authentication & Stream Presets
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">Port {formData.port}</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Username</Label>
                  <Input
                    value={formData.username}
                    onChange={(e) => {
                      const u = e.target.value;
                      setFormData({
                        ...formData,
                        username: u,
                        rtsp_url: buildRtspUrl(u, formData.password, formData.ip_address, formData.port, formData.stream_path)
                      });
                    }}
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Password</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => {
                        const p = e.target.value;
                        setFormData({
                          ...formData,
                          password: p,
                          rtsp_url: buildRtspUrl(formData.username, p, formData.ip_address, formData.port, formData.stream_path)
                        });
                      }}
                      className="h-7 text-xs font-mono pr-7"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">RTSP Port</Label>
                  <Input
                    type="number"
                    value={formData.port}
                    onChange={(e) => {
                      const port = Number(e.target.value) || 554;
                      setFormData({
                        ...formData,
                        port,
                        rtsp_url: buildRtspUrl(formData.username, formData.password, formData.ip_address, port, formData.stream_path)
                      });
                    }}
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Stream Presets */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-semibold">Stream Path Preset</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAutoDetectInModal}
                    disabled={isAutoDetecting || !formData.ip_address}
                    className="h-6 text-[10px] px-2 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10 font-medium"
                  >
                    <Activity className={`h-3 w-3 mr-1 ${isAutoDetecting ? 'animate-spin' : ''}`} />
                    {isAutoDetecting ? 'Scanning...' : '⚡ Auto-Detect Stream Path'}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-7 text-[10px] justify-start px-2 font-mono ${formData.stream_path === '/live/ch0' ? 'border-primary bg-primary/10 text-primary font-semibold' : ''}`}
                    onClick={() => {
                      const path = '/live/ch0';
                      setFormData({
                        ...formData,
                        stream_path: path,
                        port: 554,
                        rtsp_url: buildRtspUrl(formData.username, formData.password, formData.ip_address, 554, path)
                      });
                    }}
                  >
                    CTOCAM / GV Main (/live/ch0)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-7 text-[10px] justify-start px-2 font-mono ${formData.stream_path === '/live/ch1' ? 'border-primary bg-primary/10 text-primary font-semibold' : ''}`}
                    onClick={() => {
                      const path = '/live/ch1';
                      setFormData({
                        ...formData,
                        stream_path: path,
                        port: 554,
                        rtsp_url: buildRtspUrl(formData.username, formData.password, formData.ip_address, 554, path)
                      });
                    }}
                  >
                    CTOCAM / GV Sub (/live/ch1)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-7 text-[10px] justify-start px-2 font-mono ${formData.stream_path === '/stream1' ? 'border-primary bg-primary/10 text-primary font-semibold' : ''}`}
                    onClick={() => {
                      const path = '/stream1';
                      setFormData({
                        ...formData,
                        stream_path: path,
                        port: 554,
                        rtsp_url: buildRtspUrl(formData.username, formData.password, formData.ip_address, 554, path)
                      });
                    }}
                  >
                    CTOCAM ONVIF (/stream1)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-7 text-[10px] justify-start px-2 font-mono ${formData.stream_path === '/CH001.sdp' ? 'border-primary bg-primary/10 text-primary font-semibold' : ''}`}
                    onClick={() => {
                      const path = '/CH001.sdp';
                      setFormData({
                        ...formData,
                        stream_path: path,
                        port: 8554,
                        rtsp_url: buildRtspUrl(formData.username, formData.password, formData.ip_address, 8554, path)
                      });
                    }}
                  >
                    GeoVision SDP (:8554/CH001.sdp)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-7 text-[10px] justify-start px-2 font-mono ${formData.stream_path === '/Streaming/Channels/102' ? 'border-primary bg-primary/10 text-primary font-semibold' : ''}`}
                    onClick={() => {
                      const path = '/Streaming/Channels/102';
                      setFormData({
                        ...formData,
                        stream_path: path,
                        port: 554,
                        rtsp_url: buildRtspUrl(formData.username, formData.password, formData.ip_address, 554, path)
                      });
                    }}
                  >
                    Hikvision Substream (/102)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-7 text-[10px] justify-start px-2 font-mono ${formData.stream_path === '/cam/realmonitor?channel=1&subtype=0' ? 'border-primary bg-primary/10 text-primary font-semibold' : ''}`}
                    onClick={() => {
                      const path = '/cam/realmonitor?channel=1&subtype=0';
                      setFormData({
                        ...formData,
                        stream_path: path,
                        port: 554,
                        rtsp_url: buildRtspUrl(formData.username, formData.password, formData.ip_address, 554, path)
                      });
                    }}
                  >
                    Dahua / CP Plus (/cam/realmonitor)
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Direct RTSP Stream URL</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestRtsp}
                  disabled={testingRtsp || !formData.ip_address}
                  className="h-6 text-[10px] px-2 text-primary border-primary/30 hover:bg-primary/10"
                >
                  <Activity className={`h-3 w-3 mr-1 ${testingRtsp ? 'animate-spin' : ''}`} />
                  {testingRtsp ? 'Testing RTSP...' : 'Test RTSP Stream Handshake'}
                </Button>
              </div>

              <Input
                placeholder="rtsp://admin:pass@192.168.10.201:554/Streaming/Channels/102"
                value={formData.rtsp_url}
                onChange={(e) => setFormData({ ...formData, rtsp_url: e.target.value })}
                className="h-8 text-xs font-mono"
              />

              {/* Real RTSP Handshake Diagnostic Feedback */}
              {rtspTestResult && (
                <div
                  className={`text-xs p-2 rounded flex items-center gap-2 ${
                    rtspTestResult.success
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : rtspTestResult.status === 'unauthorized'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      : 'bg-destructive/10 text-destructive border border-destructive/20'
                  }`}
                >
                  {rtspTestResult.success ? (
                    <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span className="font-mono text-[11px] leading-tight">{rtspTestResult.message}</span>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                Auto-formatted from credentials above or customized directly. Converted to live HLS stream for browser & desktop viewing.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" className="text-xs">
              {editingCamera ? 'Save Changes' : 'Register Camera'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
);
};
