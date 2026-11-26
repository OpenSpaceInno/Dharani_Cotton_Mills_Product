export interface CameraDevice {
  id?: string;
  device_id: string;
  name: string;
  model: string;
  location: string;
  ip_address: string;
  mac_address?: string;
  status: 'online' | 'offline' | 'standby' | 'error';
  last_seen?: string;
  firmware?: string;
}

export interface NetworkConfig {
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  primaryDns: string;
  secondaryDns: string;
  dhcpEnabled: boolean;
}

export interface VideoConfig {
  mainStream: {
    resolution: string;
    frameRate: number;
    bitrate: number;
    compression: 'H.264' | 'H.265';
  };
  subStream: {
    resolution: string;
    frameRate: number;
    bitrate: number;
    compression: 'H.264' | 'H.265';
  };
}

export interface ImageConfig {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  wdrEnabled: boolean;
  wdrLevel: number;
  dnrEnabled: boolean;
  dnrLevel: number;
  irMode: 'auto' | 'on' | 'off';
  irDistance: number;
}

export interface ANPRConfig {
  enabled: boolean;
  detectionMode: 'continuous' | 'triggered';
  plateType: 'white' | 'black' | 'both';
  minConfidence: number;
  maxPlateWidth: number;
  minPlateWidth: number;
  captureMode: 'best_shot' | 'all';
  captureCount: number;
  captureInterval: number;
  overlayPlateNumber: boolean;
}

export interface WebhookConfig {
  url: string;
  method: 'POST' | 'GET';
  authType: 'none' | 'basic' | 'bearer';
  username?: string;
  password?: string;
  token?: string;
  timeout: number;
  retryCount: number;
}

export interface RTSPConfig {
  enabled: boolean;
  url: string;
  directUrl: string;
  useDirectUrl: boolean;
  port: number;
  username: string;
  password: string;
  streamPath: string;
  transport: 'tcp' | 'udp';
  reconnectInterval: number;
  bufferSize: number;
  lowLatencyMode: boolean;
  hlsProxyUrl: string;
}

export interface DeviceConfiguration {
  device: CameraDevice;
  network: NetworkConfig;
  video: VideoConfig;
  image: ImageConfig;
  anpr: ANPRConfig;
  webhook: WebhookConfig;
  rtsp: RTSPConfig;
}

// ==================== WEIGHBRIDGE SCALE DEVICE ====================
export interface WeighbridgeScaleDevice {
  id: string;
  device_code: string;
  display_name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  capacity_kg: number;
  port: string;
  baud_rate: number;
  interface_type: string;
  data_bits: number;
  stop_bits: number;
  parity: string;
  sample_time_ms: number;
  unit_type: string;
  mode: 'serial' | 'file_monitor' | 'tcp';
  file_path?: string;
  tcp_host?: string;
  tcp_port?: number;
  is_active: boolean | number;
  status: 'online' | 'offline' | 'standby' | 'error';
  isConnected?: boolean;
  created_at?: string;
  updated_at?: string;
}

// ==================== PRINTER DEVICE ====================
export interface PrinterDevice {
  id: string;
  name: string;
  model: string;
  type: 'thermal_80mm' | 'dot_matrix' | 'laser_a4' | 'laser_a5';
  connection_type: 'system' | 'network_tcp' | 'usb' | 'serial';
  ip_address?: string | null;
  port?: number;
  paper_size: string;
  copies: number;
  auto_print_on_completion: boolean | number;
  print_qr_code: boolean | number;
  print_images: boolean | number;
  is_default: boolean | number;
  status: 'online' | 'offline' | 'standby';
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

// ==================== FTP PROFILE ====================
export interface FtpDeviceConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  remote_dir: string;
  secure: boolean | number;
  passive: boolean | number;
  is_active: boolean | number;
  status: 'online' | 'offline' | 'standby';
  purpose: 'anpr_snapshots' | 'cloud_backup' | 'logs';
  last_test_at?: string | null;
  last_test_status?: string | null;
  created_at?: string;
  updated_at?: string;
}
