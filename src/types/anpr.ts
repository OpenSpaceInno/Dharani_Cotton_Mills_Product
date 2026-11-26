export interface Evidence {
  type: 'image' | 'video';
  url: string;
  angle: 'front' | 'side' | 'rear' | 'plate';
  timestamp: string;
  thumbnailUrl?: string;
}

export interface ANPREvent {
  eventId: string;
  type: 'ANPR_READ';
  timestamp: string;
  plantId: string;
  cameraId: string;
  vehicleRegNo: string;
  confidence: number;
  source: string;
  evidence: Evidence[];
  status: 'pending' | 'confirmed' | 'rejected' | 'manual_override';
  operatorNote?: string;
  matchedVehicle?: {
    id?: string;
    make?: string;
    model?: string;
    currentDriver?: string;
    currentDriverPhone?: string;
    status?: string;
  };
}

export interface CameraFeed {
  id: string;
  name: string;
  location: string;
  status: 'online' | 'offline' | 'error';
  ipAddress?: string;
  ip_address?: string;
  streamUrl?: string;
  stream_url?: string;
  rtsp_url?: string;
  direct_url?: string;
  hls_proxy_url?: string;
  model?: string;
  port?: number;
  username?: string;
  password?: string;
}
