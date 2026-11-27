import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { CameraFeed } from '@/types/anpr';

export function useGateCameras() {
  const [cameras, setCameras] = useState<CameraFeed[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);

  const initializeGateCameras = useCallback(async () => {
    try {
      // Fetch all configured cameras from MySQL database
      const dbCameras = await api.getCameras();
      
      if (Array.isArray(dbCameras) && dbCameras.length > 0) {
        const fullList: CameraFeed[] = dbCameras.map((c: any, index: number) => {
          const devId = c.device_id || c.id || `cam_${index + 1}`;
          const ip = (c.ip_address || '').includes('@') ? c.ip_address.split('@').pop().trim() : (c.ip_address || '').trim();
          const fallbackRtsp = ip ? `rtsp://admin:Password@123@${ip}:554/Streaming/Channels/102` : '';
          const directUrl = c.direct_url || c.rtsp_url || fallbackRtsp;

          // Normalize HLS URL so it always ends with /index.m3u8 without trailing slashes
          let cleanHls = (c.hls_proxy_url || '').trim();
          while (cleanHls.endsWith('/')) cleanHls = cleanHls.slice(0, -1);
          const slug = devId.toLowerCase().includes('scale') ? 'cam2' : (devId.toLowerCase().includes('3') ? 'cam3' : `cam${index + 1}`);
          if (cleanHls.includes(':8888/')) {
            const rawSlug = cleanHls.split(':8888/')[1].replace(/\/+$/, '').replace(/\/index\.m3u8$/, '');
            cleanHls = `/hls/${rawSlug || slug}/index.m3u8`;
          } else if (!cleanHls) {
            cleanHls = `/hls/${slug}/index.m3u8`;
          } else if (!cleanHls.endsWith('.m3u8')) {
            cleanHls = `${cleanHls}/index.m3u8`;
          }

          return {
            id: devId,
            name: c.name || `Camera ${devId}`,
            location: c.location || 'Main Gate',
            status: (c.status || 'online') as 'online' | 'offline' | 'error',
            ipAddress: ip,
            ip_address: ip,
            direct_url: directUrl,
            rtsp_url: directUrl,
            streamUrl: directUrl,
            stream_url: directUrl,
            hls_proxy_url: cleanHls,
            model: c.model || 'IP Camera',
            port: c.rtsp_port || 554,
          };
        });

        setCameras(fullList);
      } else {
        setCameras([]);
      }
      setInitialized(true);
    } catch (error) {
      console.error('Error initializing gate cameras:', error);
      setInitialized(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    initializeGateCameras();

    // 1. Cross-tab BroadcastChannel listener for instant sync with Device Config
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('rmc_camera_sync');
      channel.onmessage = (event) => {
        if (!active) return;
        console.log('📡 [GateCameras] Camera configuration change received via BroadcastChannel:', event.data);
        initializeGateCameras();
      };
    } catch (e) {
      // BroadcastChannel unsupported fallback
    }

    // 2. Same-window custom event listener
    const handleCustomSync = () => {
      if (!active) return;
      console.log('📡 [GateCameras] Camera configuration change received via window event');
      initializeGateCameras();
    };
    window.addEventListener('rmc_camera_sync', handleCustomSync);

    // 3. Periodic polling fallback every 4 seconds to catch external DB updates
    const interval = setInterval(() => {
      if (active) {
        initializeGateCameras();
      }
    }, 4000);

    return () => {
      active = false;
      if (channel) channel.close();
      window.removeEventListener('rmc_camera_sync', handleCustomSync);
      clearInterval(interval);
    };
  }, [initializeGateCameras]);

  return { cameras, initialized, loading, refreshCameras: initializeGateCameras };
}
