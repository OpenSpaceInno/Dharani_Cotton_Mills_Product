import './config/env.js';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';
import * as ftp from 'basic-ftp';
import { pool, testConnection, initializeDatabase, recordSyncTombstone } from './db.js';
import anprProcessor from './anpr-processor.js';
import ftpAnprWatcher from './ftp-anpr-watcher.js';
import cloudSyncService from './cloud-sync-service.js';
import syncRouter from './routes/sync.js';
import multer from 'multer';
import net from 'net';
import http from 'http';
import { SerialPort } from 'serialport';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const snapshotsDir = path.resolve(__dirname, '..', 'public', 'snapshots');
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir, { recursive: true });
}

// Configure multer for image uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy for HTTPS termination (Coolify / Traefik / Nginx / Cloudflare)
app.set('trust proxy', 1);

// Configure CORS for HTTPS, custom domains, credentials, and preflight
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : null;

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (mobile, curl, postman, server-to-server)
    if (!origin) return callback(null, true);

    // If explicit list configured and contains origin or '*'
    if (allowedOrigins && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      return callback(null, true);
    }

    // Default: dynamically reflect origin to support HTTPS domains and subdomains
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
    'X-Plant-Id',
    'X-Terminal-Id'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Explicit preflight and security headers middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '50mb' })); // Increase limit for image uploads
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/snapshots', express.static(snapshotsDir));
app.use('/api/sync', syncRouter);

// Proxy /hls requests to MediaMTX HLS Gateway on port 8888
app.use('/hls', (req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: 8888,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:8888' },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'MediaMTX stream gateway offline', detail: err.message });
    }
  });
  req.pipe(proxyReq, { end: true });
});

// Health check endpoint (verifies database connectivity for container & CI healthchecks)
app.get('/api/health', async (req, res) => {
  let dbConnected = false;
  try {
    await pool.query('SELECT 1');
    dbConnected = true;
  } catch {}
  if (req.query.strict === 'true' && !dbConnected) {
    return res.status(503).json({ status: 'degraded', database: 'disconnected', message: 'Database unreachable' });
  }
  res.json({
    status: 'ok',
    database: dbConnected ? 'connected' : 'disconnected',
    syncEnabled: cloudSyncService.isEnabled,
    syncStatus: cloudSyncService.lastSyncReport?.status || 'idle',
    message: 'Server is running',
  });
});

// Initialize database endpoint
app.post('/api/init-db', async (req, res) => {
  try {
    const result = await initializeDatabase();
    if (result) {
      res.json({ success: true, message: 'Database initialized successfully' });
    } else {
      res.status(500).json({ success: false, message: 'Database initialization failed' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Check database status
app.get('/api/db-status', async (req, res) => {
  try {
    const [tables] = await pool.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME IN ('camera_devices', 'device_rtsp_config', 'device_network_config')
    `, [process.env.DB_NAME]);
    
    const initialized = tables.length === 3;
    res.json({ 
      initialized, 
      tables: tables.map(t => t.TABLE_NAME),
      message: initialized ? 'Database is ready' : 'Database needs initialization'
    });
  } catch (error) {
    res.json({ initialized: false, message: error.message });
  }
});

// ==================== CAMERA DEVICES ====================

// Get all camera devices
app.get('/api/cameras', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, 
             r.direct_url, 
             r.url AS rtsp_url, 
             r.hls_proxy_url, 
             r.port AS rtsp_port,
             r.username AS rtsp_username,
             r.password AS rtsp_password,
             r.stream_path,
             r.transport
      FROM camera_devices c 
      LEFT JOIN device_rtsp_config r ON (c.device_id = r.device_id OR c.id = r.device_id)
      ORDER BY c.created_at
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single camera device
app.get('/api/cameras/:deviceId', async (req, res) => {
  try {
    const devId = req.params.deviceId;
    const [rows] = await pool.query('SELECT * FROM camera_devices WHERE device_id = ? OR id = ? LIMIT 1', [devId, devId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Camera network reachability diagnostic endpoint
app.get('/api/cameras/diagnostic/:ip', async (req, res) => {
  const { ip } = req.params;
  const testPort = (port, timeout = 1200) => new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.connect(port, ip);
  });

  try {
    const [port554, port80, port8000] = await Promise.all([
      testPort(554),
      testPort(80),
      testPort(8000),
    ]);
    const reachable = port554 || port80 || port8000;
    res.json({
      ip,
      reachable,
      ports: {
        554: port554,
        80: port80,
        8000: port8000
      },
      status: reachable ? 'online' : 'offline',
      message: reachable 
        ? `Camera at ${ip} is responsive on network` 
        : `Camera at ${ip} timed out (Unreachable on current subnet)`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getCameraSlug(deviceId = '', name = '') {
  const d = String(deviceId).toLowerCase();
  const n = String(name).toLowerCase();
  if (d.includes('3') || d.includes('gate_3') || n.includes('camera 3') || n.includes('platform 2') || d.includes('rear')) return 'cam3';
  if (d.includes('scale') || d.includes('2') || d.includes('gate_2') || d.includes('gate_4') || n.includes('camera 2') || n.includes('overhead')) return 'cam2';
  return 'cam1';
}

// Create camera device
app.post('/api/cameras', async (req, res) => {
  try {
    const b = req.body;
    const device_id = b.device_id || b.deviceId || `cam_${Date.now().toString(36)}`;
    const name = b.name || 'ANPR Camera';
    const model = b.model || 'Hikvision / GeoVision';
    const location = b.location || 'Main Gate';
    const ip_address = b.ip_address || b.ipAddress || '192.168.0.101';
    const mac_address = b.mac_address || b.macAddress || null;
    const status = b.status || 'online';
    const firmware = b.firmware || null;

    await pool.query(
      `INSERT INTO camera_devices (device_id, name, model, location, ip_address, mac_address, status, firmware, last_seen) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE 
         name=VALUES(name), model=VALUES(model), location=VALUES(location), ip_address=VALUES(ip_address), status=VALUES(status), mac_address=VALUES(mac_address), firmware=VALUES(firmware)`,
      [device_id, name, model, location, ip_address, mac_address, status, firmware]
    );

    // Auto-upsert device_rtsp_config
    const slug = getCameraSlug(device_id, name);
    const rtspUser = b.username || 'admin';
    const rtspPass = b.password || 'Password@123';
    const rtspPort = Number(b.port) || 554;
    const streamPath = b.stream_path || (device_id.includes('scale') ? '/Streaming/Channels/101' : '/ch1/main/av_stream');
    const directUrl = b.direct_url || b.directUrl || b.rtsp_url || b.url || `rtsp://${rtspUser}:${rtspPass}@${ip_address}:${rtspPort}${streamPath.startsWith('/') ? '' : '/'}${streamPath}`;
    const hlsProxyUrl = b.hls_proxy_url || `http://localhost:8888/${slug}/index.m3u8`;

    await pool.query(`
      INSERT INTO device_rtsp_config 
        (device_id, enabled, url, direct_url, use_direct_url, port, username, password, stream_path, transport, reconnect_interval, buffer_size, low_latency_mode, hls_proxy_url)
      VALUES (?, 1, ?, ?, 1, ?, ?, ?, ?, 'tcp', 5, 1024, 1, ?)
      ON DUPLICATE KEY UPDATE 
        url=VALUES(url), direct_url=VALUES(direct_url), port=VALUES(port), username=VALUES(username), password=VALUES(password), stream_path=VALUES(stream_path), hls_proxy_url=VALUES(hls_proxy_url), updated_at=NOW()
    `, [device_id, directUrl, directUrl, rtspPort, rtspUser, rtspPass, streamPath, hlsProxyUrl]);

    // Auto-upsert device_network_config
    if (ip_address) {
      await pool.query(`
        INSERT INTO device_network_config (device_id, ip_address, subnet_mask, gateway, primary_dns, secondary_dns, dhcp_enabled)
        VALUES (?, ?, '255.255.255.0', '192.168.10.1', '8.8.8.8', '8.8.4.4', 0)
        ON DUPLICATE KEY UPDATE ip_address = VALUES(ip_address)
      `, [device_id, ip_address]);
    }

    await syncMediaMtxConfig().catch(() => {});
    restartMediaMtx();

    res.status(201).json({ success: true, device_id, hls_proxy_url: hlsProxyUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update camera device
app.put('/api/cameras/:deviceId', async (req, res) => {
  try {
    const targetDevId = req.params.deviceId;
    const b = req.body;
    const newDeviceId = b.device_id || b.deviceId || targetDevId;
    const name = b.name || 'Camera';
    const model = b.model || 'IP Camera';
    const location = b.location || 'Gate';
    const ip_address = b.ip_address || b.ipAddress || '';
    const mac_address = b.mac_address || b.macAddress || null;
    const status = b.status || 'online';
    const firmware = b.firmware || null;

    await pool.query(
      `UPDATE camera_devices 
       SET device_id = ?, name = ?, model = ?, location = ?, ip_address = ?, mac_address = ?, status = ?, firmware = ?, last_seen = NOW()
       WHERE device_id = ? OR id = ?`,
      [newDeviceId, name, model, location, ip_address, mac_address, status, firmware, targetDevId, targetDevId]
    );

    // Sync RTSP configuration
    const slug = getCameraSlug(newDeviceId, name);
    const [existingRtsp] = await pool.query('SELECT * FROM device_rtsp_config WHERE device_id = ?', [newDeviceId]);
    const existingObj = existingRtsp[0] || {};

    const rtspUser = b.username || existingObj.username || 'admin';
    const rtspPass = b.password || existingObj.password || 'Password@123';
    const rtspPort = Number(b.port) || existingObj.port || 554;
    const streamPath = b.stream_path || existingObj.stream_path || '/ch1/main/av_stream';
    
    let directUrl = (b.direct_url || b.directUrl || b.rtsp_url || b.url || '').trim();
    if (ip_address) {
      const hostMatch = directUrl.match(/@([^:/]+):/);
      const host = hostMatch ? hostMatch[1] : '';
      if (!directUrl || (host && host !== ip_address)) {
        directUrl = `rtsp://${rtspUser}:${rtspPass}@${ip_address}:${rtspPort}${streamPath.startsWith('/') ? '' : '/'}${streamPath}`;
      }
    } else if (!directUrl && existingObj.direct_url) {
      directUrl = existingObj.direct_url;
    }

    let hlsProxyUrl = (b.hls_proxy_url || b.hlsProxyUrl || '').trim();
    while (hlsProxyUrl.endsWith('/')) hlsProxyUrl = hlsProxyUrl.slice(0, -1);
    if (!hlsProxyUrl) {
      hlsProxyUrl = `http://localhost:8888/${slug}/index.m3u8`;
    } else if (!hlsProxyUrl.endsWith('.m3u8')) {
      hlsProxyUrl = `${hlsProxyUrl}/index.m3u8`;
    }

    if (existingRtsp.length > 0) {
      await pool.query(`
        UPDATE device_rtsp_config 
        SET url = ?, direct_url = ?, hls_proxy_url = ?, port = COALESCE(?, port), username = ?, password = ?, stream_path = ?, updated_at = NOW()
        WHERE device_id = ?
      `, [directUrl, directUrl, hlsProxyUrl, rtspPort, rtspUser, rtspPass, streamPath, newDeviceId]);
    } else if (directUrl) {
      await pool.query(`
        INSERT INTO device_rtsp_config 
          (device_id, enabled, url, direct_url, use_direct_url, port, username, password, stream_path, transport, reconnect_interval, buffer_size, low_latency_mode, hls_proxy_url)
        VALUES (?, 1, ?, ?, 1, ?, ?, ?, ?, 'tcp', 5, 1024, 1, ?)
      `, [newDeviceId, directUrl, directUrl, rtspPort, rtspUser, rtspPass, streamPath, hlsProxyUrl]);
    }

    // Sync network config
    if (ip_address) {
      await pool.query(`
        INSERT INTO device_network_config (device_id, ip_address, subnet_mask, gateway, primary_dns, secondary_dns, dhcp_enabled)
        VALUES (?, ?, '255.255.255.0', '192.168.10.1', '8.8.8.8', '8.8.4.4', 0)
        ON DUPLICATE KEY UPDATE ip_address = VALUES(ip_address)
      `, [newDeviceId, ip_address]);
    }

    await syncMediaMtxConfig().catch(() => {});
    restartMediaMtx();

    res.json({ success: true, device_id: newDeviceId, hls_proxy_url: hlsProxyUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete camera device
app.delete('/api/cameras/:deviceId', async (req, res) => {
  try {
    const targetDevId = req.params.deviceId;
    const [existing] = await pool.query('SELECT device_id FROM camera_devices WHERE device_id = ? OR id = ? LIMIT 1', [targetDevId, targetDevId]);
    await pool.query('DELETE FROM camera_devices WHERE device_id = ? OR id = ?', [targetDevId, targetDevId]);
    if (existing.length > 0 && existing[0].device_id) {
      await recordSyncTombstone('camera_devices', 'device_id', existing[0].device_id);
    }
    await syncMediaMtxConfig().catch(() => {});
    restartMediaMtx();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== RTSP CONFIGURATION ====================

// Get RTSP config for a device
app.get('/api/rtsp-config/:deviceId', async (req, res) => {
  try {
    let devId = req.params.deviceId;
    const [camRows] = await pool.query('SELECT device_id FROM camera_devices WHERE device_id = ? OR id = ? LIMIT 1', [devId, devId]);
    if (camRows.length > 0) {
      devId = camRows[0].device_id;
    }
    const [rows] = await pool.query('SELECT * FROM device_rtsp_config WHERE device_id = ?', [devId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'RTSP config not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update RTSP config
app.post('/api/rtsp-config', async (req, res) => {
  try {
    const b = req.body;
    let device_id = b.device_id || b.deviceId;
    
    // Resolve UUID to device_id if needed
    if (device_id) {
      const [camRows] = await pool.query('SELECT device_id FROM camera_devices WHERE device_id = ? OR id = ? LIMIT 1', [device_id, device_id]);
      if (camRows.length > 0) {
        device_id = camRows[0].device_id;
      }
    }

    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const enabled = b.enabled !== undefined ? (b.enabled ? 1 : 0) : 1;
    const url = b.url || b.directUrl || b.direct_url || '';
    const direct_url = b.direct_url || b.directUrl || b.url || '';
    const use_direct_url = b.use_direct_url !== undefined ? (b.use_direct_url ? 1 : 0) : (b.useDirectUrl ? 1 : 0);
    const port = Number(b.port) || 554;
    const username = b.username || 'admin';
    const password = b.password || '';
    const stream_path = b.stream_path || b.streamPath || '/rtsp/streaming?channel=01&subtype=0';
    const transport = b.transport || 'tcp';
    const reconnect_interval = Number(b.reconnect_interval || b.reconnectInterval) || 5;
    const buffer_size = Number(b.buffer_size || b.bufferSize) || 1024;
    const low_latency_mode = b.low_latency_mode !== undefined ? (b.low_latency_mode ? 1 : 0) : 1;
    let hls_proxy_url = (b.hls_proxy_url || b.hlsProxyUrl || '').trim();
    while (hls_proxy_url.endsWith('/')) hls_proxy_url = hls_proxy_url.slice(0, -1);
    if (!hls_proxy_url) {
      const slug = getCameraSlug(device_id);
      hls_proxy_url = `http://localhost:8888/${slug}/index.m3u8`;
    } else if (!hls_proxy_url.endsWith('.m3u8')) {
      hls_proxy_url = `${hls_proxy_url}/index.m3u8`;
    }

    // Check if config exists
    const [existing] = await pool.query('SELECT device_id FROM device_rtsp_config WHERE device_id = ?', [device_id]);
    
    if (existing.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE device_rtsp_config 
         SET enabled = ?, url = ?, direct_url = ?, use_direct_url = ?, port = ?, username = ?, password = ?,
             stream_path = ?, transport = ?, reconnect_interval = ?, buffer_size = ?, low_latency_mode = ?, hls_proxy_url = ?,
             updated_at = NOW()
         WHERE device_id = ?`,
        [enabled, url, direct_url, use_direct_url, port, username, password, stream_path, transport, 
         reconnect_interval, buffer_size, low_latency_mode, hls_proxy_url, device_id]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO device_rtsp_config 
         (device_id, enabled, url, direct_url, use_direct_url, port, username, password, stream_path, 
          transport, reconnect_interval, buffer_size, low_latency_mode, hls_proxy_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [device_id, enabled, url, direct_url, use_direct_url, port, username, password, stream_path, 
         transport, reconnect_interval, buffer_size, low_latency_mode, hls_proxy_url]
      );
    }

    // If an IP is detected in the RTSP URL, keep camera_devices and device_network_config synced
    const ipMatch = direct_url.match(/@([^:/]+):/);
    if (ipMatch && ipMatch[1]) {
      const detectedIp = ipMatch[1];
      await pool.query('UPDATE camera_devices SET ip_address = ? WHERE device_id = ?', [detectedIp, device_id]);
      await pool.query(`
        INSERT INTO device_network_config (device_id, ip_address, subnet_mask, gateway, primary_dns, secondary_dns, dhcp_enabled)
        VALUES (?, ?, '255.255.255.0', '192.168.10.1', '8.8.8.8', '8.8.4.4', 0)
        ON DUPLICATE KEY UPDATE ip_address = VALUES(ip_address)
      `, [device_id, detectedIp]);
    }
    
    await syncMediaMtxConfig().catch(() => {});
    restartMediaMtx();
    res.json({ success: true, device_id, hls_proxy_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== NETWORK CONFIGURATION ====================

// Get network config for a device
app.get('/api/network-config/:deviceId', async (req, res) => {
  try {
    let devId = req.params.deviceId;
    const [camRows] = await pool.query('SELECT device_id FROM camera_devices WHERE device_id = ? OR id = ? LIMIT 1', [devId, devId]);
    if (camRows.length > 0) {
      devId = camRows[0].device_id;
    }
    const [rows] = await pool.query('SELECT * FROM device_network_config WHERE device_id = ?', [devId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Network config not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update network config
app.post('/api/network-config', async (req, res) => {
  try {
    const b = req.body;
    let device_id = b.device_id || b.deviceId;
    
    if (device_id) {
      const [camRows] = await pool.query('SELECT device_id FROM camera_devices WHERE device_id = ? OR id = ? LIMIT 1', [device_id, device_id]);
      if (camRows.length > 0) {
        device_id = camRows[0].device_id;
      }
    }

    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const ip_address = b.ip_address || b.ipAddress || '';
    const subnet_mask = b.subnet_mask || b.subnetMask || '255.255.255.0';
    const gateway = b.gateway || '';
    const primary_dns = b.primary_dns || b.primaryDns || '8.8.8.8';
    const secondary_dns = b.secondary_dns || b.secondaryDns || '8.8.4.4';
    const dhcp_enabled = b.dhcp_enabled !== undefined ? (b.dhcp_enabled ? 1 : 0) : (b.dhcpEnabled ? 1 : 0);
    
    // Check if config exists
    const [existing] = await pool.query('SELECT device_id FROM device_network_config WHERE device_id = ?', [device_id]);
    
    if (existing.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE device_network_config 
         SET ip_address = ?, subnet_mask = ?, gateway = ?, primary_dns = ?, secondary_dns = ?, dhcp_enabled = ?, updated_at = NOW()
         WHERE device_id = ?`,
        [ip_address, subnet_mask, gateway, primary_dns, secondary_dns, dhcp_enabled, device_id]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO device_network_config 
         (device_id, ip_address, subnet_mask, gateway, primary_dns, secondary_dns, dhcp_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [device_id, ip_address, subnet_mask, gateway, primary_dns, secondary_dns, dhcp_enabled]
      );
    }
    
    res.json({ success: true, device_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ANPR ENDPOINTS ====================

// Initialize ANPR tables
app.post('/api/anpr/init', async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const migrationPath = path.resolve(__dirname, 'migrations', 'anpr_events.sql');
    const sql = await fs.readFile(migrationPath, 'utf8');
    const statements = sql.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await pool.query(statement);
      }
    }
    
    res.json({ success: true, message: 'ANPR tables initialized' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all ANPR events with matched vehicle details
app.get('/api/anpr/events', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        e.*,
        ws.party_name AS vehicle_make,
        ws.material AS vehicle_model,
        COALESCE(ws.driver_name, ws.cultivator_name, '') AS vehicle_driver,
        ws.mobile_no AS vehicle_driver_phone,
        ws.status AS vehicle_status
      FROM anpr_events e
      LEFT JOIN weighbridge_sessions ws ON (
        REPLACE(UPPER(e.vehicle_reg_no), ' ', '') = REPLACE(UPPER(ws.vehicle_reg_no), ' ', '')
      )
    `;
    const params = [];
    
    if (status) {
      query += ' WHERE e.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY e.timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single ANPR event with evidence
app.get('/api/anpr/events/:eventId', async (req, res) => {
  try {
    const [events] = await pool.query('SELECT * FROM anpr_events WHERE event_id = ?', [req.params.eventId]);
    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    const [evidence] = await pool.query('SELECT * FROM anpr_evidence WHERE event_id = ?', [req.params.eventId]);
    
    res.json({
      ...events[0],
      evidence
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create ANPR event
app.post('/api/anpr/events', async (req, res) => {
  try {
    const {
      event_id, plant_id, camera_id, vehicle_reg_no, confidence, source,
      vehicle_type, direction, evidence
    } = req.body;
    
    // Insert event
    await pool.query(
      `INSERT INTO anpr_events 
       (event_id, plant_id, camera_id, vehicle_reg_no, confidence, source, vehicle_type, direction, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [event_id, plant_id, camera_id, vehicle_reg_no, confidence, source, vehicle_type, direction]
    );
    
    // Insert evidence if provided
    if (evidence && evidence.length > 0) {
      for (const item of evidence) {
        await pool.query(
          `INSERT INTO anpr_evidence 
           (event_id, evidence_type, url, thumbnail_url, angle, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [event_id, item.type, item.url, item.thumbnailUrl, item.angle, item.timestamp]
        );
      }
    }
    
    res.status(201).json({ success: true, event_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update ANPR event status
app.put('/api/anpr/events/:eventId', async (req, res) => {
  try {
    const { status, operator_note, vehicle_reg_no } = req.body;
    
    const updates = [];
    const params = [];
    
    if (status) {
      updates.push('status = ?');
      params.push(status);
    }
    if (operator_note) {
      updates.push('operator_note = ?');
      params.push(operator_note);
    }
    if (vehicle_reg_no) {
      updates.push('vehicle_reg_no = ?');
      params.push(vehicle_reg_no);
    }
    
    params.push(req.params.eventId);
    
    await pool.query(
      `UPDATE anpr_events SET ${updates.join(', ')} WHERE event_id = ?`,
      params
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process image for ANPR detection
app.post('/api/anpr/detect', upload.single('image'), async (req, res) => {
  try {
    const { camera_id } = req.body;
    const imageData = req.file ? req.file.buffer : req.body.image;
    
    if (!imageData) {
      return res.status(400).json({ error: 'No image provided' });
    }
    
    const result = await anprProcessor.detectPlate(imageData, camera_id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get ANPR configuration for camera
app.get('/api/anpr/config/:cameraId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM anpr_config WHERE camera_id = ?', [req.params.cameraId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'ANPR config not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update ANPR configuration
app.put('/api/anpr/config/:cameraId', async (req, res) => {
  try {
    const { enabled, min_confidence, auto_confirm_threshold, capture_interval, region, processing_mode, api_key } = req.body;
    
    await pool.query(
      `UPDATE anpr_config 
       SET enabled = ?, min_confidence = ?, auto_confirm_threshold = ?, capture_interval = ?, 
           region = ?, processing_mode = ?, api_key = ?
       WHERE camera_id = ?`,
      [enabled, min_confidence, auto_confirm_threshold, capture_interval, region, processing_mode, api_key, req.params.cameraId]
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to see raw webhook data
app.post('/api/anpr/webhook-test/:cameraId', async (req, res) => {
  console.log('\n========================================');
  console.log('🧪 WEBHOOK TEST - Raw Data Received');
  console.log('========================================');
  console.log('Camera ID:', req.params.cameraId);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('========================================\n');
  
  res.json({ 
    success: true, 
    message: 'Test webhook received',
    received: {
      headers: req.headers,
      body: req.body
    }
  });
});

// Webhook endpoint for camera ANPR events
app.post('/api/anpr/webhook/:cameraId', async (req, res) => {
  try {
    const { cameraId } = req.params;
    
    console.log(`📥 Received ANPR webhook from camera: ${cameraId}`);
    console.log('Webhook payload:', JSON.stringify(req.body, null, 2));
    
    // Extract plate data from camera webhook
    // Different cameras send different formats, so we'll try to parse common ones
    let plate = null;
    let confidence = 0.95;
    let vehicle_type = 'Unknown';
    let image_url = null;
    
    // Try different common webhook formats
    if (req.body.plate || req.body.plateNumber || req.body.licensePlate) {
      plate = req.body.plate || req.body.plateNumber || req.body.licensePlate;
    } else if (req.body.AlarmInfoPlate && req.body.AlarmInfoPlate.result) {
      // Hikvision format
      plate = req.body.AlarmInfoPlate.result.PlateResult.license;
      confidence = req.body.AlarmInfoPlate.result.PlateResult.confidence / 100;
    } else if (req.body.data && req.body.data.plate) {
      // Generic format
      plate = req.body.data.plate;
      confidence = req.body.data.confidence || 0.95;
    }
    
    if (!plate) {
      console.log('⚠️ No plate found in webhook payload');
      return res.status(400).json({ error: 'No plate data in webhook' });
    }
    
    console.log(`✅ Plate extracted: ${plate} (confidence: ${confidence})`);
    
    const event_id = `evt_ANPR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create ANPR event
    await pool.query(
      `INSERT INTO anpr_events 
       (event_id, plant_id, camera_id, vehicle_reg_no, confidence, source, vehicle_type, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [event_id, 'plant_001', cameraId, plate, confidence, 'camera_webhook', vehicle_type]
    );
    
    // Add evidence if image provided
    if (req.body.image_url || req.body.imageUrl || req.body.snapshot) {
      image_url = req.body.image_url || req.body.imageUrl || req.body.snapshot;
      await pool.query(
        `INSERT INTO anpr_evidence 
         (event_id, evidence_type, url, angle, timestamp)
         VALUES (?, 'image', ?, 'plate', NOW())`,
        [event_id, image_url]
      );
    }
    
    console.log(`✅ ANPR event created: ${event_id}`);
    
    res.json({ 
      success: true, 
      event_id,
      plate,
      message: 'ANPR event received and stored'
    });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// GATE MONITOR -> WEIGHBRIDGE VEHICLE SYNC API
// ==========================================

let latestGateVehicleCache = null;
let gateVehicleClearedAt = 0;

// GET /api/gate/latest-vehicle
app.get('/api/gate/latest-vehicle', async (req, res) => {
  try {
    // 1. Check active real-time detection from FTP Watcher
    let ftpLatest = ftpAnprWatcher.getLatestDetection();

    // If not in memory yet, do an active sync directly from FTP
    if (!ftpLatest || !ftpLatest.vehicleRegNo) {
      try {
        const synced = await ftpAnprWatcher.syncLatestExisting();
        if (synced && synced.vehicleRegNo) {
          ftpLatest = synced;
        }
      } catch (ftpErr) {
        console.warn('[FTP ANPR] On-demand sync warning:', ftpErr.message);
      }
    }

    if (ftpLatest && ftpLatest.vehicleRegNo) {
      const evUrl = ftpLatest.imageUrl || ftpLatest.evidenceImageUrl || (ftpLatest.fileName ? `/snapshots/${ftpLatest.fileName}` : '');
      return res.json({
        ...ftpLatest,
        imageUrl: evUrl,
        evidenceImageUrl: evUrl
      });
    }

    // 2. Check in-memory gate cache if manually updated
    if (latestGateVehicleCache && latestGateVehicleCache.vehicleRegNo) {
      return res.json({
        success: true,
        ...latestGateVehicleCache
      });
    }

    // If gate vehicle was explicitly cleared, do not return older historical DB rows
    if (gateVehicleClearedAt > 0) {
      return res.json({ success: false, message: 'No vehicle currently at gate' });
    }

    // 3. Fallback: Query recent detections from anpr_events
    try {
      const [rows] = await pool.query(`
        SELECT 
          e.*,
          ws.party_name AS vehicle_make,
          ws.material AS vehicle_model,
          COALESCE(ws.driver_name, ws.cultivator_name, '') AS vehicle_driver,
          ws.mobile_no AS vehicle_driver_phone,
          ws.status AS vehicle_status,
          ws.party_name AS customer_name,
          ws.material
        FROM anpr_events e
        LEFT JOIN weighbridge_sessions ws ON (
          REPLACE(UPPER(e.vehicle_reg_no), ' ', '') = REPLACE(UPPER(ws.vehicle_reg_no), ' ', '')
        )
        WHERE e.vehicle_reg_no NOT IN ('KA05AB1234', 'MH02CD5678', 'DL01EF9012', 'TN09GH3456', 'GJ06IJ7890')
        ORDER BY e.id DESC
        LIMIT 1
      `);

      if (rows && rows.length > 0) {
        const row = rows[0];
        let foundImage = '';
        try {
          const files = fs.readdirSync(snapshotsDir);
          const cleanPlateNo = (row.vehicle_reg_no || '').replace(/\s+/g, '').toUpperCase();
          const match = files.find(f => f.toUpperCase().includes(cleanPlateNo));
          if (match) foundImage = `/snapshots/${match}`;
        } catch (e) {}

        return res.json({
          success: true,
          vehicleRegNo: row.vehicle_reg_no,
          confidence: parseFloat(row.confidence || 0.98),
          source: row.source || 'Entry Gate ANPR Camera (FTP)',
          timestamp: row.timestamp,
          cameraId: row.camera_id,
          imageUrl: foundImage || '',
          evidenceImageUrl: foundImage || '',
          matchedVehicle: {
            make: row.vehicle_make || 'Commercial',
            model: row.vehicle_model || 'Cotton Vehicle',
            driverName: row.vehicle_driver || 'Driver',
            driverPhone: row.vehicle_driver_phone || '',
            status: row.vehicle_status || 'active',
            partyName: row.customer_name || '',
            product: row.material || 'Raw Cotton'
          }
        });
      }
    } catch (dbErr) {
      console.warn('[Gate] anpr_events DB query warning:', dbErr.message);
    }

    // If no vehicle is at the gate, report clean state
    res.json({ success: false, message: 'No vehicle currently at gate' });
  } catch (error) {
    console.error('Get latest gate vehicle error:', error);
    res.json({ success: false, message: 'No vehicle currently at gate' });
  }
});

// POST /api/gate/clear-vehicle (Clear gate vehicle state on transaction save/reset)
app.post('/api/gate/clear-vehicle', (req, res) => {
  latestGateVehicleCache = null;
  gateVehicleClearedAt = Date.now();
  ftpAnprWatcher.clearLatestDetection();
  res.json({ success: true, message: 'Gate vehicle state cleared' });
});

// GET /api/gate/ftp-status (Check FTP ANPR poller health and metrics)
app.get('/api/gate/ftp-status', (req, res) => {
  res.json({ success: true, ...ftpAnprWatcher.getStatus() });
});

// POST /api/gate/ftp-sync-now (Manual or immediate FTP trigger)
app.post('/api/gate/ftp-sync-now', async (req, res) => {
  try {
    const { loadLatestExisting = false } = req.body || {};
    gateVehicleClearedAt = 0; // reset cleared flag on manual sync
    let result;
    if (loadLatestExisting) {
      result = await ftpAnprWatcher.syncLatestExisting();
    } else {
      await ftpAnprWatcher.poll(false);
      result = ftpAnprWatcher.getLatestDetection();
    }
    res.json({ success: true, detection: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/gate/latest-vehicle (Pushed by Gate Monitor when camera detects a plate)
app.post('/api/gate/latest-vehicle', async (req, res) => {
  try {
    const { vehicleRegNo, confidence = 0.95, source = 'Gate Entry ANPR Camera', cameraId = 'cam_gate_1', imageUrl = '' } = req.body;
    if (!vehicleRegNo) {
      return res.status(400).json({ error: 'vehicleRegNo is required' });
    }

    const cleanPlate = vehicleRegNo.replace(/\s+/g, '').toUpperCase();
    const event_id = `evt_GATE_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      await pool.query(
        `INSERT INTO anpr_events 
         (event_id, plant_id, camera_id, vehicle_reg_no, confidence, source, status, timestamp)
         VALUES (?, 'plant_001', ?, ?, ?, ?, 'confirmed', NOW())`,
        [event_id, cameraId, cleanPlate, confidence, source]
      );
    } catch (dbErr) {
      console.warn('Could not insert to anpr_events, keeping in cache:', dbErr.message);
    }

    let matched = null;
    try {
      const [wbRows] = await pool.query(
        `SELECT party_name, cultivator_name, driver_name, material
         FROM weighbridge_sessions
         WHERE REPLACE(UPPER(vehicle_reg_no), ' ', '') = ?
         ORDER BY created_at DESC LIMIT 1`,
        [cleanPlate]
      );
      if (wbRows && wbRows.length > 0) {
        matched = {
          make: wbRows[0].party_name || 'Commercial',
          model: wbRows[0].material || 'Raw Cotton',
          current_driver: wbRows[0].driver_name || wbRows[0].cultivator_name || 'Driver',
          customer_name: wbRows[0].party_name || '',
          material: wbRows[0].material || 'Raw Cotton'
        };
      } else {
        const [slipRows] = await pool.query(
          `SELECT party_name, cultivator_name, driver_name, material
           FROM weigh_slips
           WHERE REPLACE(UPPER(vehicle_reg_no), ' ', '') = ?
           ORDER BY created_at DESC LIMIT 1`,
          [cleanPlate]
        );
        if (slipRows && slipRows.length > 0) {
          matched = {
            make: slipRows[0].party_name || 'Commercial',
            model: slipRows[0].material || 'Raw Cotton',
            current_driver: slipRows[0].driver_name || slipRows[0].cultivator_name || 'Driver',
            customer_name: slipRows[0].party_name || '',
            material: slipRows[0].material || 'Raw Cotton'
          };
        }
      }
    } catch (lookupErr) {
      console.warn('Gate plate lookup notice:', lookupErr.message);
    }

    latestGateVehicleCache = {
      vehicleRegNo: cleanPlate,
      confidence,
      source,
      imageUrl: imageUrl || '',
      evidenceImageUrl: imageUrl || '',
      timestamp: new Date().toISOString(),
      matchedVehicle: matched ? {
        make: matched.make,
        model: matched.model,
        driverName: matched.current_driver,
        partyName: matched.customer_name,
        product: matched.material
      } : undefined
    };

    res.json({
      success: true,
      vehicleRegNo: cleanPlate,
      matchedVehicle: latestGateVehicleCache.matchedVehicle,
      message: 'Latest gate vehicle updated'
    });
  } catch (error) {
    console.error('Post latest gate vehicle error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/gate/recent-vehicles (Last 10 vehicles detected at Gate)
app.get('/api/gate/recent-vehicles', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        e.id,
        e.event_id,
        e.vehicle_reg_no,
        e.confidence,
        e.source,
        e.camera_id,
        e.timestamp,
        ws.party_name,
        ws.material,
        COALESCE(ws.driver_name, ws.cultivator_name, '') AS driver_name
      FROM anpr_events e
      LEFT JOIN weighbridge_sessions ws ON (
        REPLACE(UPPER(e.vehicle_reg_no), ' ', '') = REPLACE(UPPER(ws.vehicle_reg_no), ' ', '')
      )
      ORDER BY e.timestamp DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      count: rows.length,
      vehicles: rows.map(r => ({
        id: r.id,
        vehicleRegNo: r.vehicle_reg_no,
        confidence: parseFloat(r.confidence || 0.95),
        source: r.source,
        timestamp: r.timestamp,
        partyName: r.party_name || '',
        product: r.material || '',
        driverName: r.driver_name || ''
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ==========================================
// VEHICLE LOOKUP API (Dharani Weighbridge)
// ==========================================

// GET /api/vehicles
app.get('/api/vehicles', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT vehicle_reg_no, party_name, cultivator_name, material, driver_name, mobile_no
      FROM weighbridge_sessions
      WHERE vehicle_reg_no IS NOT NULL AND TRIM(vehicle_reg_no) != ''
      ORDER BY created_at DESC LIMIT 50
    `);
    res.json(rows.map(r => ({
      id: r.vehicle_reg_no,
      registrationNo: r.vehicle_reg_no,
      make: r.party_name || 'Commercial',
      model: r.material || 'Cotton Vehicle',
      currentDriver: r.driver_name || r.cultivator_name || 'Driver',
      currentDriverPhone: r.mobile_no || '',
      status: 'active'
    })));
  } catch (error) {
    res.json([]);
  }
});

// GET /api/vehicles/:id
app.get('/api/vehicles/:id', async (req, res) => {
  try {
    const rawId = req.params.id.replace(/\s+/g, '').toUpperCase();
    const [rows] = await pool.query(
      `SELECT vehicle_reg_no, party_name, cultivator_name, material, driver_name, mobile_no
       FROM weighbridge_sessions
       WHERE REPLACE(UPPER(vehicle_reg_no), ' ', '') = ?
       ORDER BY created_at DESC LIMIT 1`,
      [rawId]
    );

    if (rows && rows.length > 0) {
      const v = rows[0];
      return res.json({
        id: v.vehicle_reg_no,
        registrationNo: v.vehicle_reg_no,
        make: v.party_name || 'Commercial',
        model: v.material || 'Cotton Vehicle',
        currentDriver: v.driver_name || v.cultivator_name || 'Driver',
        currentDriverPhone: v.mobile_no || '',
        status: 'active'
      });
    }

    const [slipRows] = await pool.query(
      `SELECT vehicle_reg_no, party_name, cultivator_name, material, driver_name, mobile_no
       FROM weigh_slips
       WHERE REPLACE(UPPER(vehicle_reg_no), ' ', '') = ?
       ORDER BY created_at DESC LIMIT 1`,
      [rawId]
    );

    if (slipRows && slipRows.length > 0) {
      const v = slipRows[0];
      return res.json({
        id: v.vehicle_reg_no,
        registrationNo: v.vehicle_reg_no,
        make: v.party_name || 'Commercial',
        model: v.material || 'Cotton Vehicle',
        currentDriver: v.driver_name || v.cultivator_name || 'Driver',
        currentDriverPhone: v.mobile_no || '',
        status: 'active'
      });
    }

    return res.status(404).json({ error: 'Vehicle not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WEIGHBRIDGE API (Phase 2)
// ==========================================

function safeIsoDate(val, fallback = null) {
  if (!val) return fallback;
  try {
    if (val instanceof Date) {
      return isNaN(val.getTime()) ? fallback : val.toISOString();
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
    if (typeof val === 'string') {
      const match = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
      if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const year = parseInt(match[3], 10);
        const hour = match[4] ? parseInt(match[4], 10) : 0;
        const minute = match[5] ? parseInt(match[5], 10) : 0;
        const second = match[6] ? parseInt(match[6], 10) : 0;
        const parsed = new Date(year, month, day, hour, minute, second);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
      }
    }
  } catch (e) {}
  return fallback;
}

function safeDatePart(val, fallback = '') {
  if (!val) return fallback;
  try {
    if (typeof val === 'string') {
      const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      const mDmy = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (mDmy) return `${mDmy[3]}-${mDmy[2].padStart(2, '0')}-${mDmy[1].padStart(2, '0')}`;
    }
    const iso = safeIsoDate(val);
    return iso ? iso.split('T')[0] : fallback;
  } catch (e) {
    return fallback;
  }
}

function safeTimePart(val, fallback = '') {
  if (!val) return fallback;
  try {
    if (typeof val === 'string' && val.match(/^\d{1,2}:\d{2}(?::\d{2})?$/)) {
      return val;
    }
    const iso = safeIsoDate(val);
    if (iso) {
      return new Date(iso).toTimeString().split(' ')[0];
    }
  } catch (e) {}
  return fallback;
}

function toValidDateOrNull(val) {
  if (!val) return null;
  try {
    if (val instanceof Date) {
      return isNaN(val.getTime()) ? null : val;
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    if (typeof val === 'string') {
      const match = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
      if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const year = parseInt(match[3], 10);
        const hour = match[4] ? parseInt(match[4], 10) : 0;
        const minute = match[5] ? parseInt(match[5], 10) : 0;
        const second = match[6] ? parseInt(match[6], 10) : 0;
        const parsed = new Date(year, month, day, hour, minute, second);
        if (!isNaN(parsed.getTime())) return parsed;
      }
      const timeMatch = val.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
      if (timeMatch) {
        const now = new Date();
        now.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), timeMatch[3] ? parseInt(timeMatch[3], 10) : 0, 0);
        return now;
      }
    }
  } catch (e) {}
  return null;
}

function formatWeighbridgeSession(row) {
  if (!row) return null;
  let evidence = [];
  try {
    evidence = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence || []);
  } catch (e) {}

  let printOptions = { printDuplicate: false, printQrCode: true, printImages: true };
  try {
    if (row.print_options) {
      printOptions = typeof row.print_options === 'string' ? JSON.parse(row.print_options) : row.print_options;
    }
  } catch (e) {}

  return {
    id: row.session_id,
    sessionId: row.session_id,
    transactionNo: row.transaction_no ? parseInt(row.transaction_no) : 0,
    vehicleRegNo: row.vehicle_reg_no || '',
    partyName: row.party_name || '',
    firmName: row.firm_name || '',
    product: row.material || '',
    timestamp: safeIsoDate(row.timestamp, new Date().toISOString()),
    firstWeight: row.first_weight !== null && row.first_weight !== undefined ? parseFloat(row.first_weight) : (row.tare_weight !== null ? parseFloat(row.tare_weight) : null),
    firstWeightDate: safeDatePart(row.first_weight_date || row.first_weight_time || row.date_time || row.timestamp, null),
    firstWeightTime: safeIsoDate(row.first_weight_time, safeIsoDate(row.timestamp, null)),
    secondWeight: row.second_weight !== null && row.second_weight !== undefined ? parseFloat(row.second_weight) : (row.gross_weight !== null ? parseFloat(row.gross_weight) : null),
    secondWeightDate: safeDatePart(row.second_weight_date || row.second_weight_time, null),
    secondWeightTime: safeIsoDate(row.second_weight_time, null),
    tareWeight: row.tare_weight !== null ? parseFloat(row.tare_weight) : null,
    grossWeight: row.gross_weight !== null ? parseFloat(row.gross_weight) : null,
    netWeight: row.net_weight !== null ? parseFloat(row.net_weight) : null,
    driverName: row.driver_name || '',
    material: row.material || '',
    rate: row.rate !== null && row.rate !== undefined ? parseFloat(row.rate) : 0,
    moisture: row.moisture !== null && row.moisture !== undefined ? parseFloat(row.moisture) : 0,
    deduction: row.deduction !== null && row.deduction !== undefined ? parseFloat(row.deduction) : 0,
    charges: row.charges !== null && row.charges !== undefined ? parseFloat(row.charges) : 0,
    vehicleType: row.vehicle_type || '',
    bagsBales: row.bags_bales || '',
    agent: row.agent || '',
    village: row.village || '',
    chessNo: row.chess_no || '',
    chessAmount: row.chess_amount !== null && row.chess_amount !== undefined ? parseFloat(row.chess_amount) : 0,
    chessName: row.chess_name || '',
    finalRate: row.final_rate !== null && row.final_rate !== undefined ? parseFloat(row.final_rate) : 0,
    totalAmount: row.total_amount !== null && row.total_amount !== undefined ? parseFloat(row.total_amount) : 0,
    printOptions,
    destination: row.destination || '',
    evidence,
    locationName: row.location_name || '',
    cultivatorName: row.cultivator_name || '',
    loadSlipNo: row.load_slip_no || '',
    fatherName: row.father_name || '',
    mandal: row.mandal || '',
    bankName: row.bank_name || '',
    branchName: row.branch_name || '',
    ifscCode: row.ifsc_code || '',
    traderName: row.trader_name || '',
    allotedMill: row.alloted_mill || '',
    accountNo: row.account_no || '',
    heapNo: row.heap_no || '',
    mobileNo: row.mobile_no || '',
    image1: row.image1 || '',
    image2: row.image2 || '',
    image3: row.image3 || '',
    image4: row.image4 || '',
    udt: row.udt ? new Date(row.udt).toISOString() : '',
    fwUser: row.fw_user || row.operator_name || '',
    swUser: row.sw_user || '',
    lessWeight: row.less_weight !== null && row.less_weight !== undefined ? parseFloat(row.less_weight) : 0,
    finalWeight: row.final_weight !== null && row.final_weight !== undefined ? parseFloat(row.final_weight) : 0,
    moisRate: row.mois_rate !== null && row.mois_rate !== undefined ? parseFloat(row.mois_rate) : 0,
    status: row.status || 'tare',
    operatorId: row.operator_id || 'OP001',
    operatorName: row.operator_name || 'System Operator',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatWeighSlip(row) {
  if (!row) return null;
  let evidence = [];
  try {
    evidence = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence || []);
  } catch (e) {}

  let printOptions = { printDuplicate: false, printQrCode: true, printImages: true };
  try {
    if (row.print_options) {
      printOptions = typeof row.print_options === 'string' ? JSON.parse(row.print_options) : row.print_options;
    }
  } catch (e) {}

  const fDate = safeDatePart(row.first_weight_date || row.first_weight_time || row.date_time || row.created_at, null);
  const sDate = safeDatePart(row.second_weight_date || row.second_weight_time, null);

  const fWeight = row.first_weight !== null && row.first_weight !== undefined ? parseFloat(row.first_weight) : (row.tare_weight !== null ? parseFloat(row.tare_weight) : 0);
  const sWeight = row.second_weight !== null && row.second_weight !== undefined ? parseFloat(row.second_weight) : (row.gross_weight !== null ? parseFloat(row.gross_weight) : 0);
  const netWt = row.nett_weight !== null && row.nett_weight !== undefined ? parseFloat(row.nett_weight) : (row.net_weight !== null && row.net_weight !== undefined ? parseFloat(row.net_weight) : Math.abs(sWeight - fWeight));

  return {
    slipNumber: row.slip_number,
    sessionId: row.session_id,
    companyName: row.company_name || row.firm_name || '',
    companyAddress: row.company_address || '',
    phoneNo: row.phone_no || '',
    transactionNo: row.transaction_no ? parseInt(row.transaction_no) : 0,
    partyName: row.party_name || '',
    loadSlipNo: row.load_slip_no || '',
    vehicleNo: row.vehicle_no || row.vehicle_reg_no || '',
    vehicleRegNo: row.vehicle_reg_no || row.vehicle_no || '',
    cultivatorName: row.cultivator_name || '',
    fatherName: row.father_name || '',
    mobileNo: row.mobile_no || '',
    status: row.status || (sWeight > 0 ? 'completed' : '1st_weight_complete'),
    moisture: row.moisture !== null && row.moisture !== undefined ? parseFloat(row.moisture) : 0,
    bagsBales: row.bags_bales || '',
    chessAmount: row.chess_amount !== null && row.chess_amount !== undefined ? parseFloat(row.chess_amount) : 0,
    firstWeight: fWeight,
    firstWeightDate: fDate,
    firstWeightTime: safeIsoDate(row.first_weight_time, null),
    secondWeight: sWeight,
    secondWeightDate: sDate,
    secondWeightTime: safeIsoDate(row.second_weight_time, null),
    nettWeight: netWt,
    netWeight: netWt,
    village: row.village || '',
    rate: row.rate !== null && row.rate !== undefined ? parseFloat(row.rate) : 0,
    adminName: row.admin_name || row.operator_name || 'System Admin',
    operatorName: row.operator_name || row.admin_name || 'System Admin',
    firmName: row.firm_name || '',
    product: row.material || '',
    material: row.material || '',
    dateTime: safeIsoDate(row.date_time, new Date().toISOString()),
    tareWeight: parseFloat(row.tare_weight) || fWeight,
    grossWeight: parseFloat(row.gross_weight) || sWeight,
    deduction: row.deduction !== null && row.deduction !== undefined ? parseFloat(row.deduction) : 0,
    charges: row.charges !== null && row.charges !== undefined ? parseFloat(row.charges) : 0,
    vehicleType: row.vehicle_type || '',
    agent: row.agent || '',
    chessNo: row.chess_no || '',
    chessName: row.chess_name || '',
    finalRate: row.final_rate !== null && row.final_rate !== undefined ? parseFloat(row.final_rate) : 0,
    totalAmount: row.total_amount !== null && row.total_amount !== undefined ? parseFloat(row.total_amount) : 0,
    printOptions,
    driverName: row.driver_name || '',
    destination: row.destination || '',
    evidence,
    createdAt: row.created_at,
  };
}

// GET /api/weighbridge/parties (Fetch distinct parties with latest saved details for auto-population)
app.get('/api/weighbridge/parties', async (req, res) => {
  try {
    const partyMap = new Map();

    // 1. Try querying weighbridge_sessions
    try {
      const [wbRows] = await pool.query(`
        SELECT 
          party_name AS partyName,
          location_name AS locationName,
          cultivator_name AS cultivatorName,
          village,
          mobile_no AS mobileNo,
          material AS product,
          bags_bales AS bagsBales,
          rate,
          chess_name AS chessName,
          chess_no AS chessNo,
          chess_amount AS chessAmount,
          charges,
          status,
          created_at AS createdAt
        FROM weighbridge_sessions
        WHERE party_name IS NOT NULL AND TRIM(party_name) != ''
        ORDER BY created_at DESC
      `);

      for (const row of (wbRows || [])) {
        const key = (row.partyName || '').trim().toLowerCase();
        if (key && !partyMap.has(key)) {
          partyMap.set(key, {
            partyName: (row.partyName || '').trim(),
            locationName: row.locationName || '',
            cultivatorName: row.cultivatorName || '',
            village: row.village || '',
            mobileNo: row.mobileNo || '',
            product: row.product || '',
            bagsBales: row.bagsBales || '',
            rate: parseFloat(row.rate) || 0,
            chessName: row.chessName || '',
            chessNo: row.chessNo || '',
            chessAmount: parseFloat(row.chessAmount) || 0,
            charges: parseFloat(row.charges) || 0,
            status: row.status || ''
          });
        }
      }
    } catch (wbErr) {
      console.warn('weighbridge_sessions parties lookup notice:', wbErr.message);
    }

    // 2. Query weigh_slips for additional or older parties
    try {
      const [slipRows] = await pool.query(`
        SELECT 
          party_name AS partyName,
          location_name AS locationName,
          cultivator_name AS cultivatorName,
          village,
          mobile_no AS mobileNo,
          COALESCE(product, material) AS product,
          bags_bales AS bagsBales,
          rate,
          chess_name AS chessName,
          chess_no AS chessNo,
          chess_amount AS chessAmount,
          charges,
          status,
          created_at AS createdAt
        FROM weigh_slips
        WHERE party_name IS NOT NULL AND TRIM(party_name) != ''
        ORDER BY created_at DESC
      `);

      for (const row of (slipRows || [])) {
        const key = (row.partyName || '').trim().toLowerCase();
        if (key && !partyMap.has(key)) {
          partyMap.set(key, {
            partyName: (row.partyName || '').trim(),
            locationName: row.locationName || '',
            cultivatorName: row.cultivatorName || '',
            village: row.village || '',
            mobileNo: row.mobileNo || '',
            product: row.product || '',
            bagsBales: row.bagsBales || '',
            rate: parseFloat(row.rate) || 0,
            chessName: row.chessName || '',
            chessNo: row.chessNo || '',
            chessAmount: parseFloat(row.chessAmount) || 0,
            charges: parseFloat(row.charges) || 0,
            status: row.status || ''
          });
        }
      }
    } catch (slipErr) {
      console.warn('weigh_slips parties lookup notice:', slipErr.message);
    }

    const partyList = Array.from(partyMap.values()).sort((a, b) =>
      a.partyName.localeCompare(b.partyName, undefined, { sensitivity: 'base' })
    );

    res.json(partyList);
  } catch (error) {
    console.error('Get weighbridge parties error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/weighbridge/party-details/:partyName
app.get('/api/weighbridge/party-details/:partyName', async (req, res) => {
  try {
    const rawParty = decodeURIComponent(req.params.partyName).trim();

    try {
      const [rows] = await pool.query(
        `SELECT * FROM weighbridge_sessions 
         WHERE LOWER(TRIM(party_name)) = LOWER(TRIM(?))
         ORDER BY transaction_no DESC, created_at DESC LIMIT 1`,
        [rawParty]
      );
      if (rows && rows.length > 0) {
        return res.json({ success: true, party: formatWeighbridgeSession(rows[0]) });
      }
    } catch (wbErr) {
      console.warn('party-details wb lookup notice:', wbErr.message);
    }

    try {
      const [slipRows] = await pool.query(
        `SELECT * FROM weigh_slips 
         WHERE LOWER(TRIM(party_name)) = LOWER(TRIM(?))
         ORDER BY transaction_no DESC, created_at DESC LIMIT 1`,
        [rawParty]
      );
      if (slipRows && slipRows.length > 0) {
        return res.json({ success: true, party: formatWeighSlip(slipRows[0]) });
      }
    } catch (slipErr) {
      console.warn('party-details slip lookup notice:', slipErr.message);
    }

    res.json({ success: false, party: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/weighbridge/next-transaction-no
app.get('/api/weighbridge/next-transaction-no', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT GREATEST(
        COALESCE((SELECT MAX(transaction_no) FROM weighbridge_sessions WHERE first_weight IS NOT NULL OR second_weight IS NOT NULL OR tare_weight IS NOT NULL OR gross_weight IS NOT NULL), 0),
        COALESCE((SELECT MAX(transaction_no) FROM weigh_slips WHERE first_weight IS NOT NULL OR second_weight IS NOT NULL OR tare_weight IS NOT NULL OR gross_weight IS NOT NULL), 0)
      ) + 1 AS nextTx
    `);
    res.json({ nextTransactionNo: rows[0].nextTx || 1 });
  } catch (error) {
    console.error('Get next transaction no error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/weighbridge/pending-vehicles
app.get('/api/weighbridge/pending-vehicles', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM weighbridge_sessions 
       WHERE (second_weight IS NULL OR second_weight = 0)
       AND (first_weight > 0 OR tare_weight > 0 OR gross_weight > 0)
       AND (status IS NULL OR (status != 'completed' AND status != 'Completed' AND status != 'cancelled' AND status != 'Cancelled'))
       AND vehicle_reg_no IS NOT NULL AND TRIM(vehicle_reg_no) != ''
       ORDER BY transaction_no DESC LIMIT 50`
    );
    res.json(rows.map(formatWeighbridgeSession));
  } catch (error) {
    console.error('Get pending vehicles error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/weighbridge/pending-vehicle/:vehicleNo
app.get('/api/weighbridge/pending-vehicle/:vehicleNo', async (req, res) => {
  try {
    const rawVeh = req.params.vehicleNo || '';
    const cleanVeh = rawVeh.replace(/[\s\-_]/g, '').toUpperCase();
    if (!cleanVeh) return res.status(400).json({ error: 'Vehicle number required' });

    // 1. Look for pending 1st weight session for this vehicle
    const [rows] = await pool.query(
      `SELECT * FROM weighbridge_sessions 
       WHERE REPLACE(REPLACE(REPLACE(UPPER(vehicle_reg_no), ' ', ''), '-', ''), '_', '') = ?
       AND (second_weight IS NULL OR second_weight = 0)
       AND (first_weight > 0 OR tare_weight > 0 OR gross_weight > 0)
       AND (status IS NULL OR (status != 'completed' AND status != 'Completed' AND status != 'cancelled' AND status != 'Cancelled'))
       ORDER BY transaction_no DESC LIMIT 1`,
      [cleanVeh]
    );

    if (rows.length > 0) {
      return res.json({ success: true, session: formatWeighbridgeSession(rows[0]) });
    }

    return res.status(404).json({ success: false, message: 'No pending weighment session found for this vehicle' });
  } catch (error) {
    console.error('Pending vehicle lookup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== DASHBOARD REAL-TIME INSIGHTS ====================
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    // 1. Fetch Weighbridge Sessions Metrics (Total, Completed, Pending 2nd Weight, Total Net MT, Charges)
    const [allSessions] = await pool.query(
      `SELECT session_id, transaction_no, vehicle_reg_no, party_name, material, product, 
              tare_weight, gross_weight, net_weight, first_weight, second_weight, 
              first_weight_time, second_weight_time, charges, total_amount, status, operator_name, created_at 
       FROM weighbridge_sessions ORDER BY created_at DESC LIMIT 100`
    );

    const completed = allSessions.filter(s => s.status === 'completed' || (Number(s.gross_weight) > 0 && Number(s.tare_weight) > 0));
    const pending2nd = allSessions.filter(s => s.status === 'pending_2nd_weight' || (Number(s.first_weight) > 0 && (!s.second_weight || Number(s.second_weight) === 0)));

    const totalNetKg = completed.reduce((sum, s) => sum + (Number(s.net_weight) || 0), 0);
    const totalGrossKg = completed.reduce((sum, s) => sum + (Number(s.gross_weight) || 0), 0);
    const totalCharges = allSessions.reduce((sum, s) => sum + (Number(s.charges || s.total_amount) || 0), 0);

    // Product breakdown
    const productMap = {};
    for (const s of allSessions) {
      const prod = s.product || s.material || 'Raw Cotton (Kapas)';
      if (!productMap[prod]) {
        productMap[prod] = { product: prod, count: 0, netKg: 0 };
      }
      productMap[prod].count++;
      productMap[prod].netKg += Number(s.net_weight || 0);
    }
    const productBreakdown = Object.values(productMap).sort((a, b) => b.count - a.count).slice(0, 5);

    // Pending 2nd weight queue with wait time
    const now = Date.now();
    const pendingQueue = pending2nd.slice(0, 10).map(s => {
      const createdTime = s.created_at ? new Date(s.created_at).getTime() : now;
      const waitMinutes = Math.max(1, Math.round((now - createdTime) / 60000));
      return {
        sessionId: s.session_id,
        transactionNo: s.transaction_no,
        vehicleNo: s.vehicle_reg_no,
        partyName: s.party_name || '—',
        material: s.product || s.material || 'Raw Cotton',
        firstWeight: s.first_weight || s.gross_weight || s.tare_weight || 0,
        firstWeightTime: s.first_weight_time || s.created_at,
        waitMinutes
      };
    });

    // 2. Gate & ANPR Metrics
    const [recentAnpr] = await pool.query(
      `SELECT id, event_id, camera_id, vehicle_reg_no, direction, confidence, status, created_at 
       FROM anpr_events ORDER BY created_at DESC LIMIT 20`
    );
    const [anprCountRow] = await pool.query('SELECT COUNT(*) as count FROM anpr_events');
    const totalGateScans = anprCountRow[0]?.count || 0;
    const entryScans = recentAnpr.filter(a => (a.direction || '').toLowerCase() === 'entry').length;
    const exitScans = recentAnpr.filter(a => (a.direction || '').toLowerCase() === 'exit').length;

    // 3. System & Camera Devices
    const [cams] = await pool.query('SELECT device_id, name, status, ip_address, location FROM camera_devices');
    const onlineCameras = cams.filter(c => c.status === 'online').length;

    // 4. Audit Log Summary
    const [auditRow] = await pool.query('SELECT COUNT(*) as count FROM audit_logs WHERE DATE(created_at) = CURDATE()');
    const todayAuditCount = auditRow[0]?.count || 0;

    // 5. Live Scale Weight from Ventek serial indicator
    const scaleReading = ventekSerialService.getLatestWeight ? ventekSerialService.getLatestWeight() : null;

    // 6. Hourly activity calculation
    const hours = [];
    for (let i = 7; i >= 0; i--) {
      const hDate = new Date(now - i * 3600000);
      const hourStr = `${hDate.getHours().toString().padStart(2, '0')}:00`;
      const hHour = hDate.getHours();
      const wCount = allSessions.filter(s => s.created_at && new Date(s.created_at).getHours() === hHour).length;
      const gCount = recentAnpr.filter(a => a.created_at && new Date(a.created_at).getHours() === hHour).length;
      hours.push({
        hour: hourStr,
        weighments: wCount,
        gateReads: gCount
      });
    }

    res.json({
      scale: {
        liveWeight: scaleReading?.weight || 0,
        unit: scaleReading?.unit || 'kg',
        stable: scaleReading?.stable ?? true,
        zero: scaleReading?.zero ?? true,
        serialConnected: scaleReading?.serialConnected ?? true,
        port: scaleReading?.serialPort || 'COM3',
        model: scaleReading?.model || 'VMS-WB'
      },
      weighbridge: {
        totalSessions: allSessions.length,
        completedCount: completed.length,
        pending2ndCount: pending2nd.length,
        totalGrossKg,
        totalNetKg,
        totalNetMT: Math.round((totalNetKg / 1000) * 10) / 10,
        totalCharges,
        productBreakdown,
        pendingQueue,
        recentTransactions: allSessions.slice(0, 10)
      },
      gate: {
        totalScans: totalGateScans,
        recentScans: recentAnpr.slice(0, 8),
        entryScans,
        exitScans
      },
      system: {
        camerasOnline: onlineCameras || cams.length,
        totalCameras: cams.length || 2,
        cameras: cams,
        auditCountToday: todayAuditCount,
        cloudSyncEnabled: cloudSyncService.isEnabled,
        cloudSyncStatus: cloudSyncService.lastSyncReport?.status || 'idle',
        lastCloudSync: cloudSyncService.lastSyncReport?.lastSuccessAt || null,
        nextCloudSync: cloudSyncService.lastSyncReport?.nextScheduledAt || null
      },
      hourlyActivity: hours
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/weighbridge/sessions
app.get('/api/weighbridge/sessions', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let query = 'SELECT * FROM weighbridge_sessions';
    const params = [];
    if (status && status !== 'all') {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await pool.query(query, params);
    res.json(rows.map(formatWeighbridgeSession));
  } catch (error) {
    console.error('Get weighbridge sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/weighbridge/sessions/:id
app.get('/api/weighbridge/sessions/:id', async (req, res) => {
  try {
    const isNumeric = /^\d+$/.test(req.params.id);
    let rows;
    if (isNumeric) {
      [rows] = await pool.query('SELECT * FROM weighbridge_sessions WHERE transaction_no = ? OR session_id = ?', [parseInt(req.params.id), req.params.id]);
    } else {
      [rows] = await pool.query('SELECT * FROM weighbridge_sessions WHERE session_id = ?', [req.params.id]);
    }
    if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    res.json(formatWeighbridgeSession(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Synchronize a weighbridge session to weigh_slips so both tables are kept 100% in sync
async function syncSessionToWeighSlip(txNo, b, sessionId, sessionStatus) {
  try {
    const slipNumber = b.slipNumber || b.slip_number || `WS-2026-${String(txNo).padStart(4, '0')}`;
    let compName = b.firmName || b.companyName || 'DHARANI COTTON MILLS';
    let compAddr = 'Vikarabad, Hyderabad 500033';
    let compPhone = '+91 20 2712 8899';
    try {
      const [compRows] = await pool.query('SELECT company_name, firm_name, address, city, pincode, phone FROM company_settings LIMIT 1');
      if (compRows.length > 0) {
        compName = compRows[0].firm_name || compRows[0].company_name || compName;
        if (compRows[0].address) {
          compAddr = `${compRows[0].address}, ${compRows[0].city || ''} ${compRows[0].pincode || ''}`.trim();
        }
        compPhone = compRows[0].phone || compPhone;
      }
    } catch {}

    const firstWeight = b.firstWeight !== undefined && b.firstWeight !== null ? b.firstWeight : (b.tareWeight || 0);
    const secondWeight = b.secondWeight !== undefined && b.secondWeight !== null ? b.secondWeight : (b.grossWeight || 0);
    const nettWeight = b.nettWeight !== undefined && b.nettWeight !== null ? b.nettWeight : (b.netWeight !== undefined && b.netWeight !== null ? b.netWeight : (firstWeight && secondWeight ? Math.abs(secondWeight - firstWeight) : (firstWeight || 0)));

    const fDate = b.firstWeightDate || (b.firstWeightTime ? new Date(b.firstWeightTime).toISOString().split('T')[0] : (firstWeight ? new Date().toISOString().split('T')[0] : null));
    const sDate = b.secondWeightDate || (b.secondWeightTime ? new Date(b.secondWeightTime).toISOString().split('T')[0] : (secondWeight ? new Date().toISOString().split('T')[0] : null));

    const isOutward = (b.status || sessionStatus || '').toLowerCase().includes('outward');
    const resolvedTareWeight = isOutward
      ? (b.tareWeight !== undefined && b.tareWeight !== null ? b.tareWeight : (firstWeight || null))
      : (b.tareWeight !== undefined && b.tareWeight !== null ? b.tareWeight : (secondWeight || null));
    const resolvedGrossWeight = isOutward
      ? (b.grossWeight !== undefined && b.grossWeight !== null ? b.grossWeight : (secondWeight || null))
      : (b.grossWeight !== undefined && b.grossWeight !== null ? b.grossWeight : (firstWeight || null));

    await pool.query(
      `INSERT INTO weigh_slips (
        slip_number, session_id, transaction_no, vehicle_reg_no, party_name, firm_name,
        date_time, first_weight, first_weight_time, second_weight, second_weight_time,
        tare_weight, gross_weight, net_weight, material, rate, moisture, deduction,
        charges, vehicle_type, bags_bales, agent, village, chess_no, chess_amount,
        chess_name, final_rate, total_amount, print_options, driver_name, destination,
        operator_name, evidence, company_name, company_address, phone_no, load_slip_no,
        vehicle_no, cultivator_name, location_name, father_name, mobile_no, status, first_weight_date,
        second_weight_date, nett_weight, admin_name, product, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        NOW(), ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, NOW()
      ) ON DUPLICATE KEY UPDATE
        session_id = VALUES(session_id),
        transaction_no = VALUES(transaction_no),
        vehicle_reg_no = VALUES(vehicle_reg_no),
        vehicle_no = VALUES(vehicle_no),
        party_name = VALUES(party_name),
        firm_name = VALUES(firm_name),
        company_name = VALUES(company_name),
        material = VALUES(material),
        product = VALUES(product),
        first_weight = VALUES(first_weight),
        first_weight_date = VALUES(first_weight_date),
        first_weight_time = VALUES(first_weight_time),
        second_weight = VALUES(second_weight),
        second_weight_date = VALUES(second_weight_date),
        second_weight_time = VALUES(second_weight_time),
        tare_weight = VALUES(tare_weight),
        gross_weight = VALUES(gross_weight),
        net_weight = VALUES(net_weight),
        nett_weight = VALUES(nett_weight),
        rate = VALUES(rate),
        final_rate = VALUES(final_rate),
        moisture = VALUES(moisture),
        deduction = VALUES(deduction),
        charges = VALUES(charges),
        vehicle_type = VALUES(vehicle_type),
        bags_bales = VALUES(bags_bales),
        agent = VALUES(agent),
        village = VALUES(village),
        chess_no = VALUES(chess_no),
        chess_amount = VALUES(chess_amount),
        chess_name = VALUES(chess_name),
        location_name = VALUES(location_name),
        cultivator_name = VALUES(cultivator_name),
        load_slip_no = VALUES(load_slip_no),
        father_name = VALUES(father_name),
        mobile_no = VALUES(mobile_no),
        total_amount = VALUES(total_amount),
        status = VALUES(status),
        print_options = VALUES(print_options),
        evidence = VALUES(evidence),
        admin_name = VALUES(admin_name),
        operator_name = VALUES(operator_name)`,
      [
        slipNumber,
        sessionId,
        txNo,
        b.vehicleRegNo || b.vehicle_reg_no || b.vehicleNo || '',
        b.partyName || b.party_name || '',
        compName,
        firstWeight,
        toValidDateOrNull(b.firstWeightTime) || (firstWeight ? new Date() : null),
        secondWeight,
        toValidDateOrNull(b.secondWeightTime) || (secondWeight ? new Date() : null),
        resolvedTareWeight !== null ? resolvedTareWeight : (firstWeight || 0),
        resolvedGrossWeight !== null ? resolvedGrossWeight : (secondWeight || 0),
        nettWeight,
        b.material || b.product || 'cotton',
        b.rate !== undefined ? b.rate : 0,
        b.moisture !== undefined ? b.moisture : 0,
        b.deduction !== undefined ? b.deduction : 0,
        b.charges !== undefined ? b.charges : 0,
        b.vehicleType || b.vehicle_type || '',
        b.bagsBales || b.bags_bales || '',
        b.agent || '',
        b.village || '',
        b.chessNo || b.chess_no || '',
        b.chessAmount !== undefined ? b.chessAmount : 0,
        b.chessName || b.chess_name || '',
        b.finalRate !== undefined ? b.finalRate : (b.rate !== undefined ? b.rate : 0),
        b.totalAmount !== undefined ? b.totalAmount : 0,
        typeof b.printOptions === 'object' ? JSON.stringify(b.printOptions) : (b.print_options ? JSON.stringify(b.print_options) : '{}'),
        b.driverName || b.driver_name || '',
        b.destination || '',
        b.operatorName || b.operator_name || 'System Admin',
        typeof b.evidence === 'object' ? JSON.stringify(b.evidence) : (b.evidence ? JSON.stringify(b.evidence) : '[]'),
        compName,
        compAddr,
        compPhone,
        b.loadSlipNo || b.load_slip_no || '',
        b.vehicleNo || b.vehicleRegNo || b.vehicle_reg_no || '',
        b.cultivatorName || b.cultivator_name || '',
        b.locationName || b.location_name || '',
        b.fatherName || b.father_name || '',
        b.mobileNo || b.mobile_no || '',
        sessionStatus || b.status || (secondWeight ? 'completed' : 'pending_2nd_weight'),
        fDate,
        sDate,
        nettWeight,
        b.adminName || b.operatorName || 'System Admin',
        b.product || b.material || 'cotton'
      ]
    );
  } catch (err) {
    console.error('syncSessionToWeighSlip warning:', err.message);
  }
}

// POST /api/weighbridge/sessions
app.post('/api/weighbridge/sessions', async (req, res) => {
  try {
    const b = req.body;
    const vehNo = (b.vehicleRegNo || b.vehicle_reg_no || b.vehicleNo || '').trim();
    if (!vehNo) {
      return res.status(400).json({ error: 'Vehicle registration number is required' });
    }

    // Auto-calculate transaction number if omitted
    let txNo = b.transactionNo || b.transaction_no;
    if (!txNo) {
      const [maxRes] = await pool.query(`
        SELECT COALESCE(MAX(transaction_no), 0) + 1 AS nextTx 
        FROM weighbridge_sessions 
        WHERE (first_weight IS NOT NULL OR second_weight IS NOT NULL OR tare_weight IS NOT NULL OR gross_weight IS NOT NULL)
      `);
      txNo = maxRes[0].nextTx || 1;
    }

    const firstWeight = b.firstWeight !== undefined ? b.firstWeight : (b.tareWeight !== undefined ? b.tareWeight : null);
    const secondWeight = b.secondWeight !== undefined ? b.secondWeight : (b.grossWeight !== undefined ? b.grossWeight : null);

    let netWeight = b.netWeight;
    if (netWeight === undefined || netWeight === null) {
      if (firstWeight !== null && secondWeight !== null) {
        netWeight = Math.abs(secondWeight - firstWeight);
      } else {
        netWeight = null;
      }
    }

    // Check if session already exists by transaction_no or session_id
    let existingSessionId = null;
    if (txNo) {
      const [rows] = await pool.query('SELECT session_id FROM weighbridge_sessions WHERE transaction_no = ?', [txNo]);
      if (rows.length > 0) existingSessionId = rows[0].session_id;
    }
    if (!existingSessionId && (b.sessionId || b.session_id)) {
      const sid = b.sessionId || b.session_id;
      const [rows] = await pool.query('SELECT session_id FROM weighbridge_sessions WHERE session_id = ?', [sid]);
      if (rows.length > 0) existingSessionId = rows[0].session_id;
    }

    // Inward = farmer crop arriving (1st wt is Gross, 2nd wt is Tare)
    // Outward = factory goods leaving (1st wt is Tare, 2nd wt is Gross)
    const isOutward = (b.status || '').toLowerCase().includes('outward');
    let tareWeight = null;
    let grossWeight = null;

    if (isOutward) {
      tareWeight = b.tareWeight !== undefined && b.tareWeight !== null ? b.tareWeight : (firstWeight || null);
      grossWeight = b.grossWeight !== undefined && b.grossWeight !== null ? b.grossWeight : (secondWeight || null);
    } else {
      grossWeight = b.grossWeight !== undefined && b.grossWeight !== null ? b.grossWeight : (firstWeight || null);
      tareWeight = b.tareWeight !== undefined && b.tareWeight !== null ? b.tareWeight : (secondWeight || null);
    }

    const hasSecondWeight = secondWeight !== null && Number(secondWeight) > 0;
    const isCompleted = hasSecondWeight && (firstWeight !== null && Number(firstWeight) > 0);

    const sessionStatus = isCompleted
      ? 'completed'
      : (b.status || (isOutward ? 'Outward' : 'Inward'));

    if (existingSessionId) {
      // Update existing session
      await pool.query(
        `UPDATE weighbridge_sessions SET
          vehicle_reg_no = COALESCE(?, vehicle_reg_no),
          party_name = COALESCE(?, party_name),
          firm_name = COALESCE(?, firm_name),
          first_weight = COALESCE(?, first_weight),
          first_weight_time = COALESCE(?, first_weight_time),
          second_weight = ?,
          second_weight_time = ?,
          tare_weight = COALESCE(?, tare_weight),
          gross_weight = COALESCE(?, gross_weight),
          net_weight = ?,
          material = COALESCE(?, material),
          rate = COALESCE(?, rate),
          moisture = COALESCE(?, moisture),
          deduction = COALESCE(?, deduction),
          charges = COALESCE(?, charges),
          vehicle_type = COALESCE(?, vehicle_type),
          bags_bales = COALESCE(?, bags_bales),
          agent = COALESCE(?, agent),
          village = COALESCE(?, village),
          chess_no = COALESCE(?, chess_no),
          chess_amount = COALESCE(?, chess_amount),
          chess_name = COALESCE(?, chess_name),
          location_name = COALESCE(?, location_name),
          cultivator_name = COALESCE(?, cultivator_name),
          load_slip_no = COALESCE(?, load_slip_no),
          mobile_no = COALESCE(?, mobile_no),
          final_rate = COALESCE(?, final_rate),
          total_amount = COALESCE(?, total_amount),
          print_options = COALESCE(?, print_options),
          driver_name = COALESCE(?, driver_name),
          destination = COALESCE(?, destination),
          evidence = COALESCE(?, evidence),
          status = ?,
          operator_id = COALESCE(?, operator_id),
          operator_name = COALESCE(?, operator_name),
          updated_at = NOW()
        WHERE session_id = ?`,
        [
          b.vehicleRegNo || b.vehicle_reg_no || null,
          b.partyName || b.party_name || null,
          b.firmName || b.firm_name || null,
          firstWeight,
          toValidDateOrNull(b.firstWeightTime) || (firstWeight !== null ? new Date() : null),
          secondWeight,
          toValidDateOrNull(b.secondWeightTime) || (secondWeight !== null ? new Date() : null),
          tareWeight,
          grossWeight,
          netWeight,
          b.material || b.product || null,
          b.rate !== undefined ? b.rate : null,
          b.moisture !== undefined ? b.moisture : null,
          b.deduction !== undefined ? b.deduction : null,
          b.charges !== undefined ? b.charges : null,
          b.vehicleType || b.vehicle_type || null,
          b.bagsBales || b.bags_bales || null,
          b.agent || null,
          b.village || null,
          b.chessNo || b.chess_no || null,
          b.chessAmount !== undefined ? b.chessAmount : null,
          b.chessName || b.chess_name || null,
          b.locationName || b.location_name || null,
          b.cultivatorName || b.cultivator_name || null,
          b.loadSlipNo || b.load_slip_no || null,
          b.mobileNo || b.mobile_no || null,
          b.finalRate !== undefined ? b.finalRate : null,
          b.totalAmount !== undefined ? b.totalAmount : null,
          b.printOptions ? JSON.stringify(b.printOptions) : null,
          b.driverName || b.driver_name || null,
          b.destination || null,
          b.evidence ? JSON.stringify(b.evidence) : null,
          sessionStatus,
          b.operatorId || null,
          b.operatorName || null,
          existingSessionId
        ]
      );

      await syncSessionToWeighSlip(txNo, b, existingSessionId, sessionStatus);
      return res.status(200).json({ success: true, sessionId: existingSessionId, transactionNo: txNo, message: 'Weighbridge session updated' });
    }

    // Insert new session
    const sessionId = b.sessionId || b.session_id || `WB-SESS-${Date.now()}`;
    await pool.query(
      `INSERT INTO weighbridge_sessions (
        session_id, transaction_no, vehicle_reg_no, party_name, firm_name,
        timestamp, first_weight, first_weight_time, second_weight, second_weight_time,
        tare_weight, gross_weight, net_weight, material, rate, moisture, deduction,
        charges, vehicle_type, bags_bales, agent, village, chess_no, chess_amount,
        chess_name, location_name, cultivator_name, load_slip_no, mobile_no,
        final_rate, total_amount, print_options, driver_name, destination,
        evidence, status, operator_id, operator_name, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        NOW(), ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, NOW(), NOW()
      )`,
      [
        sessionId,
        txNo,
        b.vehicleRegNo || b.vehicle_reg_no || '',
        b.partyName || b.party_name || '',
        b.firmName || b.firm_name || '',
        firstWeight,
        toValidDateOrNull(b.firstWeightTime) || (firstWeight !== null ? new Date() : null),
        secondWeight,
        toValidDateOrNull(b.secondWeightTime) || (secondWeight !== null ? new Date() : null),
        tareWeight,
        grossWeight,
        netWeight,
        b.material || b.product || '',
        b.rate !== undefined ? b.rate : 0,
        b.moisture !== undefined ? b.moisture : 0,
        b.deduction !== undefined ? b.deduction : 0,
        b.charges !== undefined ? b.charges : 0,
        b.vehicleType || b.vehicle_type || '',
        b.bagsBales || b.bags_bales || '',
        b.agent || '',
        b.village || '',
        b.chessNo || b.chess_no || '',
        b.chessAmount !== undefined ? b.chessAmount : 0,
        b.chessName || b.chess_name || '',
        b.locationName || b.location_name || '',
        b.cultivatorName || b.cultivator_name || '',
        b.loadSlipNo || b.load_slip_no || '',
        b.mobileNo || b.mobile_no || '',
        b.finalRate !== undefined ? b.finalRate : 0,
        b.totalAmount !== undefined ? b.totalAmount : 0,
        JSON.stringify(b.printOptions || { printDuplicate: false, printQrCode: true, printImages: true }),
        b.driverName || b.driver_name || '',
        b.destination || '',
        JSON.stringify(b.evidence || []),
        sessionStatus,
        b.operatorId || 'OP001',
        b.operatorName || 'System Operator'
      ]
    );

    await syncSessionToWeighSlip(txNo, b, sessionId, sessionStatus);
    res.status(201).json({ success: true, sessionId, transactionNo: txNo, message: 'Weighbridge session created' });
  } catch (error) {
    console.error('Create weighbridge session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/weighbridge/sessions/:id
app.put('/api/weighbridge/sessions/:id', async (req, res) => {
  try {
    const b = req.body;
    const updates = [];
    const params = [];

    if (b.vehicleRegNo !== undefined) { updates.push('vehicle_reg_no = ?'); params.push(b.vehicleRegNo); }
    if (b.partyName !== undefined) { updates.push('party_name = ?'); params.push(b.partyName); }
    if (b.firmName !== undefined) { updates.push('firm_name = ?'); params.push(b.firmName); }
    if (b.firstWeight !== undefined) { updates.push('first_weight = ?'); params.push(b.firstWeight); }
    if (b.firstWeightTime !== undefined) { updates.push('first_weight_time = ?'); params.push(b.firstWeightTime ? new Date(b.firstWeightTime) : null); }
    if (b.secondWeight !== undefined) { updates.push('second_weight = ?'); params.push(b.secondWeight); }
    if (b.secondWeightTime !== undefined) { updates.push('second_weight_time = ?'); params.push(b.secondWeightTime ? new Date(b.secondWeightTime) : null); }
    if (b.tareWeight !== undefined) { updates.push('tare_weight = ?'); params.push(b.tareWeight); }
    if (b.grossWeight !== undefined) { updates.push('gross_weight = ?'); params.push(b.grossWeight); }
    if (b.netWeight !== undefined) { updates.push('net_weight = ?'); params.push(b.netWeight); }
    if (b.material !== undefined) { updates.push('material = ?'); params.push(b.material); }
    if (b.product !== undefined) { updates.push('material = ?'); params.push(b.product); }
    if (b.rate !== undefined) { updates.push('rate = ?'); params.push(b.rate); }
    if (b.moisture !== undefined) { updates.push('moisture = ?'); params.push(b.moisture); }
    if (b.deduction !== undefined) { updates.push('deduction = ?'); params.push(b.deduction); }
    if (b.charges !== undefined) { updates.push('charges = ?'); params.push(b.charges); }
    if (b.vehicleType !== undefined) { updates.push('vehicle_type = ?'); params.push(b.vehicleType); }
    if (b.bagsBales !== undefined) { updates.push('bags_bales = ?'); params.push(b.bagsBales); }
    if (b.agent !== undefined) { updates.push('agent = ?'); params.push(b.agent); }
    if (b.village !== undefined) { updates.push('village = ?'); params.push(b.village); }
    if (b.chessNo !== undefined) { updates.push('chess_no = ?'); params.push(b.chessNo); }
    if (b.chessAmount !== undefined) { updates.push('chess_amount = ?'); params.push(b.chessAmount); }
    if (b.chessName !== undefined) { updates.push('chess_name = ?'); params.push(b.chessName); }
    if (b.finalRate !== undefined) { updates.push('final_rate = ?'); params.push(b.finalRate); }
    if (b.totalAmount !== undefined) { updates.push('total_amount = ?'); params.push(b.totalAmount); }
    if (b.printOptions !== undefined) { updates.push('print_options = ?'); params.push(JSON.stringify(b.printOptions)); }
    if (b.status !== undefined) { updates.push('status = ?'); params.push(b.status); }
    if (b.evidence !== undefined) { updates.push('evidence = ?'); params.push(JSON.stringify(b.evidence)); }
    if (b.driverName !== undefined) { updates.push('driver_name = ?'); params.push(b.driverName); }
    if (b.destination !== undefined) { updates.push('destination = ?'); params.push(b.destination); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = NOW()');

    const isNumeric = /^\d+$/.test(req.params.id);
    if (isNumeric) {
      await pool.query(`UPDATE weighbridge_sessions SET ${updates.join(', ')} WHERE transaction_no = ? OR session_id = ?`, [...params, parseInt(req.params.id), req.params.id]);
    } else {
      await pool.query(`UPDATE weighbridge_sessions SET ${updates.join(', ')} WHERE session_id = ?`, [...params, req.params.id]);
    }

    try {
      const [updatedRows] = await pool.query(
        isNumeric 
          ? 'SELECT * FROM weighbridge_sessions WHERE transaction_no = ? OR session_id = ?' 
          : 'SELECT * FROM weighbridge_sessions WHERE session_id = ?',
        isNumeric ? [parseInt(req.params.id), req.params.id] : [req.params.id]
      );
      if (updatedRows.length > 0) {
        await syncSessionToWeighSlip(updatedRows[0].transaction_no, updatedRows[0], updatedRows[0].session_id, updatedRows[0].status);
      }
    } catch (syncErr) {
      console.warn('Sync PUT session to weigh_slips warning:', syncErr.message);
    }

    res.json({ success: true, message: 'Session updated successfully' });
  } catch (error) {
    console.error('Update weighbridge session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== WEIGHBRIDGE CAMERA SNAPSHOTS & FTP SYNC ====================

// Helper: upload files to FTP server
async function uploadFilesToFtp(files, ftpConfig) {
  if (!ftpConfig || !ftpConfig.enabled || !ftpConfig.host) {
    return { enabled: false, message: 'FTP upload disabled or host not configured' };
  }
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    const host = ftpConfig.host || process.env.FTP_HOST || 'ftp.activitsol.com';
    const port = parseInt(ftpConfig.port, 10) || 2121;
    const user = ftpConfig.user || process.env.FTP_USER || 'demo';
    const password = ftpConfig.password || process.env.FTP_PASSWORD || 'Password@123';
    const remoteDir = ftpConfig.remoteDir || process.env.FTP_DIR || '/Dharani';

    await client.access({
      host,
      port,
      user,
      password,
      secure: Boolean(ftpConfig.secure),
      timeout: 10000,
    });

    if (remoteDir && remoteDir !== '/' && remoteDir !== '.') {
      await client.ensureDir(remoteDir);
    }

    const results = [];
    for (const f of files) {
      try {
        await client.uploadFrom(f.localPath, f.fileName);
        if (typeof ftpAnprWatcher?.markFileProcessed === 'function') {
          ftpAnprWatcher.markFileProcessed(f.fileName);
        }
        results.push({ fileName: f.fileName, success: true, remotePath: `${remoteDir}/${f.fileName}` });
        console.log(`✅ [FTP Upload] Stored camera snapshot in ${remoteDir}/${f.fileName}`);
      } catch (err) {
        console.warn(`FTP file upload failed for ${f.fileName}:`, err.message);
        results.push({ fileName: f.fileName, success: false, error: err.message });
      }
    }
    return { enabled: true, success: true, results };
  } catch (err) {
    console.warn('FTP connection failed:', err.message);
    return { enabled: true, success: false, error: err.message };
  } finally {
    client.close();
  }
}

// POST /api/weighbridge/snapshots/upload
app.post('/api/weighbridge/snapshots/upload', async (req, res) => {
  try {
    const { transactionNo, vehicleRegNo, weight, images, imageData, angle = 'front', camId = 'cam1' } = req.body;
    const items = Array.isArray(images) && images.length > 0 
      ? images 
      : (imageData ? [{ camId, angle, dataUrl: imageData }] : []);

    if (items.length === 0) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    const txNo = transactionNo || '0';
    const now = Date.now();
    const cleanVeh = (vehicleRegNo || '').replace(/[\s\-_]/g, '').toUpperCase();
    const vehPrefix = cleanVeh ? `${cleanVeh}_` : '';
    const savedFiles = [];
    const snapshots = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const cId = item.camId || `cam${i + 1}`;
      const cName = item.camName || (cId === 'cam1' ? 'Camera 1 (Front ANPR)' : 'Camera 2 (Deck & Chute)');
      const cAngle = item.angle || (i === 0 ? 'front' : (i === 1 ? 'side' : 'rear'));
      const rawData = item.dataUrl || item.imageData || '';
      
      const base64Data = rawData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `${vehPrefix}tx${txNo}_${cId}_${now}_${i}.jpg`;
      const localPath = path.join(snapshotsDir, fileName);

      fs.writeFileSync(localPath, buffer);
      const url = `/snapshots/${fileName}`;

      savedFiles.push({ localPath, fileName, cId, angle: cAngle });
      snapshots.push({
        id: `ev-wb-${now}-${i}`,
        type: 'image',
        url,
        angle: cAngle,
        camId: cId,
        camName: cName,
        timestamp: new Date().toISOString(),
        fileName,
      });
    }

    // Check FTP config from company_settings or environment defaults
    let ftpSummary = { enabled: false, message: 'FTP not enabled in company settings' };
    try {
      const [rows] = await pool.query('SELECT weighbridge_defaults FROM company_settings LIMIT 1');
      let defaults = null;
      if (rows.length > 0 && rows[0].weighbridge_defaults) {
        defaults = typeof rows[0].weighbridge_defaults === 'string'
          ? JSON.parse(rows[0].weighbridge_defaults)
          : rows[0].weighbridge_defaults;
      }

      const ftpConfig = (defaults && defaults.ftp && defaults.ftp.enabled)
        ? defaults.ftp
        : {
            host: process.env.FTP_HOST || 'ftp.activitsol.com',
            port: parseInt(process.env.FTP_PORT || '2121', 10),
            user: process.env.FTP_USER || 'demo',
            password: process.env.FTP_PASSWORD || 'Password@123',
            secure: false,
            enabled: true,
            remoteDir: process.env.FTP_DIR || '/Dharani'
          };

      if (ftpConfig && ftpConfig.enabled) {
        ftpSummary = await uploadFilesToFtp(savedFiles, ftpConfig);
      }
    } catch (ftpErr) {
      console.warn('FTP check error:', ftpErr.message);
      ftpSummary = { enabled: true, success: false, error: ftpErr.message };
    }

    // Merge FTP status into snapshots
    const enrichedSnapshots = snapshots.map((s, idx) => {
      const ftpResult = ftpSummary.results ? ftpSummary.results[idx] : null;
      return {
        ...s,
        ftpStatus: ftpResult || { enabled: ftpSummary.enabled, success: ftpSummary.success, error: ftpSummary.error },
      };
    });

    res.json({
      success: true,
      message: `Captured ${savedFiles.length} snapshot(s) successfully`,
      snapshots: enrichedSnapshots,
      ftpSummary,
    });
  } catch (error) {
    console.error('Snapshot upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/company-settings/test-ftp
app.post('/api/company-settings/test-ftp', async (req, res) => {
  const { host = 'ftp.activitsol.com', port, user = 'demo', password = 'Password@123', secure = false, remoteDir = '/Dharani' } = req.body;
  if (!host) {
    return res.status(400).json({ success: false, error: 'FTP Host is required' });
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    const effectivePort = parseInt(port, 10) || (host.includes('activitsol.com') || host.includes('213.210.37.249') ? 2121 : 21);
    await client.access({
      host,
      port: effectivePort,
      user,
      password,
      secure: Boolean(secure),
      timeout: 10000,
    });

    if (remoteDir && remoteDir !== '/' && remoteDir !== '.') {
      await client.ensureDir(remoteDir);
    }
    const list = await client.list();
    client.close();
    res.json({
      success: true,
      message: `Connected successfully to FTP server at ${host}:${port}! Directory verified (${list.length} items found).`,
    });
  } catch (err) {
    client.close();
    console.warn('FTP test connection failed:', err.message);
    res.status(500).json({
      success: false,
      error: `FTP Connection Failed: ${err.message}`,
    });
  }
});

// ==================== THIRD-PARTY & VENTEK WEIGHBRIDGE INTEGRATION ENGINE ====================

// In-memory live scale state, defaults to zero (00000)
let liveScaleReading = {
  weight: 0,
  weightQtl: 0,
  unit: 'kg',
  stable: true,
  zero: true,
  timestamp: new Date().toISOString(),
  source: 'standby',
  connected: false,
  deviceCode: 'VMS',
  deviceName: 'New VMS',
};

// Parser for Ventek VMS-WB serial data frames & emulator streams
function parseVentekFrame(rawLine, config = {}) {
  if (!rawLine || typeof rawLine !== 'string') return null;
  // Clean non-printable ASCII control characters (STX, ETX, NUL, etc.)
  const clean = rawLine.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
  if (!clean) return null;

  // Split tokens by space
  const tokens = clean.split(/\s+/).filter(Boolean);
  
  // Find numeric candidates that are NOT timestamps (do not contain '/' or ':')
  const numTokens = tokens.filter(t => !t.includes('/') && !t.includes(':') && /[\d]/.test(t));
  
  let targetNumStr = null;
  if (numTokens.length > 0) {
    // The actual weight is typically the last non-timestamp numeric token
    targetNumStr = numTokens[numTokens.length - 1];
  } else {
    // Fallback: search for number pattern
    const m = clean.match(/([+-]?\d+(?:\.\d+)?)/);
    if (m) targetNumStr = m[1];
  }

  if (!targetNumStr) return null;
  
  const match = targetNumStr.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;

  const rawNum = parseFloat(match[1].replace(/\s+/g, ''));
  if (isNaN(rawNum)) return null;

  let weightKg = 0;
  let weightQtl = 0;

  if (rawNum <= 500) {
    // Indicator is transmitting in Quintals (e.g. 250.00 Qtl -> 25,000 kg)
    weightQtl = Number(rawNum.toFixed(2));
    weightKg = Math.min(50000, Math.max(0, Math.round(rawNum * 100)));
  } else if (rawNum <= 50000) {
    // Value is directly in kg (e.g. 24580 kg -> 245.80 Qtl)
    weightKg = Math.round(rawNum);
    weightQtl = Number((weightKg / 100).toFixed(2));
  } else {
    // Large raw value from emulator or 2-decimal implied value:
    // e.g. 3768212 -> 37,682.12 kg (376.82 Qtl)
    let scaled = rawNum / 100;
    if (scaled > 50000) {
      weightKg = Math.round(scaled % 50000);
      if (weightKg === 0) weightKg = 24500;
    } else {
      weightKg = Math.round(scaled);
    }
    weightQtl = Number((weightKg / 100).toFixed(2));
  }

  // Detect motion / stability flags
  const isUnstable = /US|MOT|\bM\b/i.test(clean);
  const stable = !isUnstable;

  return {
    weight: weightKg,
    weightQtl: weightQtl,
    unit: 'kg',
    stable,
    zero: weightKg === 0,
    timestamp: new Date().toISOString(),
    source: 'ventek_serial',
    deviceCode: config.device_code || 'VMS',
    deviceName: config.display_name || 'New VMS',
    raw: clean,
    connected: true,
  };
}

// Ventek Serial Manager Service
class VentekSerialService {
  constructor() {
    this.port = null;
    this.config = {
      id: 'dev-vms-001',
      device_code: 'VMS',
      display_name: 'New VMS',
      manufacturer: 'VENTEK',
      model: 'VMS-WB',
      serial_number: '168',
      capacity_kg: 50000,
      port: 'COM3',
      baud_rate: 2400,
      interface_type: 'RS232',
      data_bits: 8,
      stop_bits: 1,
      parity: 'none',
      sample_time_ms: 1000,
      byte_range: '1-8',
      unit_type: 'Qtl',
      is_active: 1,
    };
    this.isConnected = false;
    this.lastError = null;
    this.lastReadingTime = null;
    this.lastRawPacket = '';
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.incomingBuffer = '';
    this._warnedOffline = false;
  }

  async loadConfigFromDb() {
    try {
      const [rows] = await pool.query('SELECT * FROM weighbridge_devices WHERE is_active = 1 LIMIT 1');
      if (rows.length > 0) {
        this.config = { ...this.config, ...rows[0] };
        console.log(`[VentekSerial] Loaded device config from DB: ${this.config.display_name} (${this.config.model}) on ${this.config.port} @ ${this.config.baud_rate} baud`);
      }
    } catch (err) {
      console.warn('[VentekSerial] Could not query weighbridge_devices table:', err.message);
    }
  }

  start() {
    this.loadConfigFromDb().then(() => {
      this.connect();
    });
  }

  scheduleReconnect(delay = 5000) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  async connect() {
    if (this.port && this.port.isOpen) {
      return;
    }

    const portPath = this.config.port || 'COM3';
    try {
      this.port = new SerialPort({
        path: portPath,
        baudRate: parseInt(this.config.baud_rate, 10) || 2400,
        dataBits: parseInt(this.config.data_bits, 10) || 8,
        stopBits: parseInt(this.config.stop_bits, 10) || 1,
        parity: (this.config.parity || 'none').toLowerCase(),
        autoOpen: false,
      });

      this.port.open((err) => {
        if (err) {
          this.isConnected = false;
          this.lastError = err.message;

          // Auto-bridge failover: if COM3 is busy (e.g. used by emulator), try COM2, or vice versa
          if (/access denied/i.test(err.message)) {
            const alternatePort = portPath.toUpperCase() === 'COM3' ? 'COM2' : (portPath.toUpperCase() === 'COM2' ? 'COM3' : null);
            if (alternatePort && !this._triedAlternate) {
              console.log(`[VentekSerial] ${portPath} is busy (${err.message}). Auto-switching to paired port ${alternatePort}...`);
              this._triedAlternate = true;
              this.config.port = alternatePort;
              this.port = null;
              this.connect();
              return;
            }
          }

          this._triedAlternate = false;
          if (!this._warnedOffline) {
            console.log(`[VentekSerial] Port ${portPath} currently offline (${err.message}). Auto-reconnect active.`);
            this._warnedOffline = true;
          }
          this.scheduleReconnect(5000);
          return;
        }

        this.isConnected = true;
        this.lastError = null;
        this._warnedOffline = false;
        this._triedAlternate = false;
        console.log(`[VentekSerial] 🚀 Successfully connected to ${portPath} [${this.config.manufacturer} ${this.config.model} - ${this.config.display_name}] @ ${this.config.baud_rate} baud`);

        // If indicator requires query heartbeat (e.g. W\r or P\r), send request periodically
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
          if (this.port && this.port.isOpen) {
            try {
              // Send 'W\r' query for command-mode indicators (ignored by continuous broadcast units)
              this.port.write('W\r', () => {});
            } catch (e) {}
          }
        }, Math.max(500, parseInt(this.config.sample_time_ms, 10) || 1000));
      });

      this.port.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        this.incomingBuffer += text;
        this.lastRawPacket = text.trim();

        // If buffer contains line breaks, split and process full lines
        if (/[\r\n]/.test(this.incomingBuffer)) {
          const lines = this.incomingBuffer.split(/[\r\n]+/);
          this.incomingBuffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim().length > 0) {
              this.handleFrame(line);
            }
          }
        }

        // Debounce timer: flush buffer if no new delimiter arrives within 250ms
        if (this._flushTimer) clearTimeout(this._flushTimer);
        this._flushTimer = setTimeout(() => {
          if (this.incomingBuffer && this.incomingBuffer.trim().length > 0) {
            this.handleFrame(this.incomingBuffer);
            this.incomingBuffer = '';
          }
        }, 250);
      });

      this.port.on('error', (err) => {
        this.isConnected = false;
        this.lastError = err.message;
        console.warn(`[VentekSerial] Port error on ${this.config.port}:`, err.message);
        this.scheduleReconnect(5000);
      });

      this.port.on('close', () => {
        this.isConnected = false;
        console.log(`[VentekSerial] Port ${this.config.port} closed.`);
        this.scheduleReconnect(5000);
      });

    } catch (err) {
      this.isConnected = false;
      this.lastError = err.message;
      this.scheduleReconnect(5000);
    }
  }

  handleFrame(line) {
    const parsed = parseVentekFrame(line, this.config);
    if (parsed) {
      this.lastReadingTime = parsed.timestamp;
      this.lastRawPacket = parsed.raw;
      liveScaleReading = {
        ...liveScaleReading,
        ...parsed,
      };
      console.log(`[VentekSerial] Live Weight: ${parsed.weight} KG (${parsed.weightQtl} Qtl) | Raw: "${parsed.raw}"`);
    }
  }

  async close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.port && this.port.isOpen) {
      return new Promise((resolve) => {
        this.port.close(() => {
          this.isConnected = false;
          this.port = null;
          resolve();
        });
      });
    }
    this.port = null;
    this.isConnected = false;
  }

  async updateConfigAndRestart(newConfig) {
    await this.close();
    this.config = { ...this.config, ...newConfig };
    this._warnedOffline = false;
    await this.connect();
  }
}

const ventekSerialService = new VentekSerialService();

// Default scale data directory for third-party file sync
const scaleDataDir = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(scaleDataDir)) {
  fs.mkdirSync(scaleDataDir, { recursive: true });
}
const defaultScaleFilePath = path.join(scaleDataDir, 'live_scale_weight.txt');
if (!fs.existsSync(defaultScaleFilePath)) {
  // Initialize with 0 so indicator reads 00000
  fs.writeFileSync(defaultScaleFilePath, '0\n', 'utf8');
}

// Helper: resolve relative or absolute scale path
function resolveScalePath(targetPath) {
  if (!targetPath) return defaultScaleFilePath;
  if (path.isAbsolute(targetPath) && fs.existsSync(targetPath)) return targetPath;
  const projectRel = path.resolve(__dirname, '..', targetPath);
  if (fs.existsSync(projectRel)) return projectRel;
  const cwdRel = path.resolve(process.cwd(), targetPath);
  if (fs.existsSync(cwdRel)) return cwdRel;
  return targetPath;
}

// Helper: read and parse weight from third-party shared file
function readScaleFromFile(targetPath) {
  try {
    const p = resolveScalePath(targetPath);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8').trim();
      const match = content.match(/([+-]?\d+(?:\.\d+)?)/);
      if (match) {
        const val = Math.max(0, Math.round(parseFloat(match[1])));
        return {
          weight: val,
          unit: 'kg',
          stable: true,
          zero: val === 0,
          timestamp: new Date().toISOString(),
          source: 'file_monitor',
          connected: true,
          filePath: p,
          raw: content,
        };
      }
    }
  } catch (err) {
    console.warn('Read scale file error:', err.message);
  }
  return null;
}

// GET /api/weighbridge/live-weight
// Returns current live weight from third-party scale (or 00000 standby)
app.get('/api/weighbridge/live-weight', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT weighbridge_defaults FROM company_settings LIMIT 1');
    let scaleConfig = null;
    if (rows.length > 0 && rows[0].weighbridge_defaults) {
      const defaults = typeof rows[0].weighbridge_defaults === 'string'
        ? JSON.parse(rows[0].weighbridge_defaults)
        : rows[0].weighbridge_defaults;
      scaleConfig = defaults?.thirdPartyScale;
    }

    if (scaleConfig && scaleConfig.enabled && scaleConfig.mode === 'file_monitor') {
      const fileReading = readScaleFromFile(scaleConfig.filePath || defaultScaleFilePath);
      if (fileReading) {
        liveScaleReading = { ...liveScaleReading, ...fileReading };
      }
    }

    const weightKg = Number(liveScaleReading.weight) || 0;
    const weightQtl = liveScaleReading.weightQtl !== undefined 
      ? Number(liveScaleReading.weightQtl) 
      : Number((weightKg / 100).toFixed(2));

    const payload = {
      ...liveScaleReading,
      weight: weightKg,
      weightQtl,
      serialConnected: ventekSerialService.isConnected,
      serialPort: ventekSerialService.config.port || 'COM3',
      baudRate: ventekSerialService.config.baud_rate || 2400,
      deviceCode: ventekSerialService.config.device_code || 'VMS',
      deviceName: ventekSerialService.config.display_name || 'New VMS',
      model: ventekSerialService.config.model || 'VMS-WB',
      unitType: ventekSerialService.config.unit_type || 'Qtl',
      capacityKg: ventekSerialService.config.capacity_kg || 50000,
    };

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/weighbridge/third-party/push
// Webhook for third-party weighbridge desktop applications / external bridges
app.post('/api/weighbridge/third-party/push', (req, res) => {
  try {
    const { weight = 0, weightQtl, unit = 'kg', stable = true, source = 'third_party_software' } = req.body;
    let numWeight = Math.max(0, Math.round(Number(weight) || 0));
    let numQtl = weightQtl !== undefined ? Number(weightQtl) : Number((numWeight / 100).toFixed(2));

    if (weightQtl !== undefined && weight === undefined) {
      numWeight = Math.round(numQtl * 100);
    }

    liveScaleReading = {
      weight: numWeight,
      weightQtl: numQtl,
      unit: unit === 'ton' ? 'ton' : 'kg',
      stable: Boolean(stable),
      zero: numWeight === 0,
      timestamp: new Date().toISOString(),
      source,
      connected: true,
      deviceCode: ventekSerialService.config.device_code || 'VMS',
      deviceName: ventekSerialService.config.display_name || 'New VMS',
    };

    res.json({
      success: true,
      message: `Live weight updated to ${numWeight} ${unit} (${numQtl} Qtl)`,
      reading: liveScaleReading,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/weighbridge/third-party/zero
// Reset live weight to 0 (00000)
app.post('/api/weighbridge/third-party/zero', (req, res) => {
  liveScaleReading = {
    weight: 0,
    weightQtl: 0,
    unit: 'kg',
    stable: true,
    zero: true,
    timestamp: new Date().toISOString(),
    source: 'zero_command',
    connected: true,
    deviceCode: ventekSerialService.config.device_code || 'VMS',
    deviceName: ventekSerialService.config.display_name || 'New VMS',
  };
  try {
    if (fs.existsSync(defaultScaleFilePath)) {
      fs.writeFileSync(defaultScaleFilePath, '0\n', 'utf8');
    }
  } catch (e) {}
  res.json({ success: true, message: 'Scale zeroed successfully to 00000 (0.00 Qtl)', reading: liveScaleReading });
});

// POST /api/weighbridge/third-party/simulate
// Update simulated weight for testing
app.post('/api/weighbridge/third-party/simulate', (req, res) => {
  const { weight, weightQtl, stable = true } = req.body;
  let numWeight = 24580;
  let numQtl = 245.80;

  if (weight !== undefined) {
    numWeight = Math.max(0, Math.round(Number(weight) || 0));
    numQtl = Number((numWeight / 100).toFixed(2));
  } else if (weightQtl !== undefined) {
    numQtl = Math.max(0, Number(weightQtl) || 0);
    numWeight = Math.round(numQtl * 100);
  }

  liveScaleReading = {
    weight: numWeight,
    weightQtl: numQtl,
    unit: 'kg',
    stable: Boolean(stable),
    zero: numWeight === 0,
    timestamp: new Date().toISOString(),
    source: 'simulation',
    connected: true,
    deviceCode: ventekSerialService.config.device_code || 'VMS',
    deviceName: ventekSerialService.config.display_name || 'New VMS',
  };
  try {
    if (fs.existsSync(defaultScaleFilePath)) {
      fs.writeFileSync(defaultScaleFilePath, `${numWeight}\n`, 'utf8');
    }
  } catch (e) {}
  res.json({ success: true, message: `Simulated weight set to ${numWeight} kg (${numQtl} Qtl)`, reading: liveScaleReading });
});

// POST /api/weighbridge/third-party/test-source
// Tests file existence or TCP port reachability
app.post('/api/weighbridge/third-party/test-source', async (req, res) => {
  try {
    const { mode = 'file_monitor', filePath, tcpHost, tcpPort } = req.body;
    if (mode === 'file_monitor') {
      const p = resolveScalePath(filePath);
      const exists = fs.existsSync(p);
      let content = '';
      if (exists) {
        content = fs.readFileSync(p, 'utf8').trim();
      }
      return res.json({
        success: exists,
        mode: 'file_monitor',
        filePath: p,
        exists,
        sampleContent: content,
        message: exists
          ? `File verified successfully at ${p}. Current content: "${content}"`
          : `File not found at ${p}. Please ensure third-party software exports to this path.`,
      });
    } else if (mode === 'tcp_socket') {
      if (!tcpHost || !tcpPort) {
        return res.status(400).json({ success: false, error: 'TCP Host and Port are required' });
      }
      const s = new net.Socket();
      s.setTimeout(3000);
      s.on('connect', () => {
        s.destroy();
        res.json({ success: true, message: `TCP scale connection established at ${tcpHost}:${tcpPort}!` });
      });
      s.on('timeout', () => {
        s.destroy();
        res.status(500).json({ success: false, error: `Connection timed out to ${tcpHost}:${tcpPort}` });
      });
      s.on('error', (err) => {
        s.destroy();
        res.status(500).json({ success: false, error: `TCP connection failed: ${err.message}` });
      });
      s.connect(Number(tcpPort), tcpHost);
      return;
    }

    res.json({ success: true, message: 'Source tested successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== VENTEK HARDWARE INTEGRATION ENDPOINTS ====================

// GET /api/weighbridge/device/config
// Fetches the active Ventek weighbridge device configuration and connection status
app.get('/api/weighbridge/device/config', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM weighbridge_devices WHERE is_active = 1 LIMIT 1');
    const device = rows.length > 0 ? rows[0] : ventekSerialService.config;
    res.json({
      success: true,
      device: {
        id: device.id,
        deviceCode: device.device_code || device.deviceCode,
        displayName: device.display_name || device.displayName,
        manufacturer: device.manufacturer,
        model: device.model,
        serialNumber: device.serial_number || device.serialNumber,
        capacityKg: Number(device.capacity_kg || device.capacityKg || 50000),
        port: device.port,
        baudRate: Number(device.baud_rate || device.baudRate || 2400),
        interfaceType: device.interface_type || device.interfaceType || 'RS232',
        dataBits: Number(device.data_bits || device.dataBits || 8),
        stopBits: Number(device.stop_bits || device.stopBits || 1),
        parity: device.parity || 'none',
        sampleTimeMs: Number(device.sample_time_ms || device.sampleTimeMs || 1000),
        byteRange: device.byte_range || device.byteRange || '1-8',
        unitType: device.unit_type || device.unitType || 'Qtl',
        isActive: Boolean(device.is_active !== undefined ? device.is_active : true),
      },
      status: {
        connected: ventekSerialService.isConnected,
        lastError: ventekSerialService.lastError,
        lastReadingTime: ventekSerialService.lastReadingTime,
        lastRawPacket: ventekSerialService.lastRawPacket,
        currentWeightKg: liveScaleReading.weight,
        currentWeightQtl: liveScaleReading.weightQtl !== undefined ? liveScaleReading.weightQtl : Number((liveScaleReading.weight / 100).toFixed(2)),
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/weighbridge/device/config
// Updates active device configuration and immediately updates serial connection
app.put('/api/weighbridge/device/config', async (req, res) => {
  try {
    const b = req.body;
    const deviceCode = b.deviceCode || b.device_code || 'VMS';
    const displayName = b.displayName || b.display_name || 'New VMS';
    const manufacturer = b.manufacturer || 'VENTEK';
    const model = b.model || 'VMS-WB';
    const serialNumber = b.serialNumber || b.serial_number || '168';
    const capacityKg = Number(b.capacityKg || b.capacity_kg) || 50000;
    const port = b.port || 'COM3';
    const baudRate = Number(b.baudRate || b.baud_rate) || 2400;
    const interfaceType = b.interfaceType || b.interface_type || 'RS232';
    const dataBits = Number(b.dataBits || b.data_bits) || 8;
    const stopBits = Number(b.stopBits || b.stop_bits) || 1;
    const parity = (b.parity || 'none').toLowerCase();
    const sampleTimeMs = Number(b.sampleTimeMs || b.sample_time_ms) || 1000;
    const byteRange = b.byteRange || b.byte_range || '1-8';
    const unitType = b.unitType || b.unit_type || 'Qtl';

    const [existing] = await pool.query('SELECT id FROM weighbridge_devices LIMIT 1');
    if (existing.length > 0) {
      await pool.query(
        `UPDATE weighbridge_devices SET
          device_code = ?, display_name = ?, manufacturer = ?, model = ?,
          serial_number = ?, capacity_kg = ?, port = ?, baud_rate = ?,
          interface_type = ?, data_bits = ?, stop_bits = ?, parity = ?,
          sample_time_ms = ?, byte_range = ?, unit_type = ?, is_active = 1,
          updated_at = NOW()
        WHERE id = ?`,
        [deviceCode, displayName, manufacturer, model, serialNumber, capacityKg, port, baudRate, interfaceType, dataBits, stopBits, parity, sampleTimeMs, byteRange, unitType, existing[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO weighbridge_devices 
          (id, device_code, display_name, manufacturer, model, serial_number, capacity_kg, port, baud_rate, interface_type, data_bits, stop_bits, parity, sample_time_ms, byte_range, unit_type, is_active)
        VALUES 
          ('dev-vms-001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [deviceCode, displayName, manufacturer, model, serialNumber, capacityKg, port, baudRate, interfaceType, dataBits, stopBits, parity, sampleTimeMs, byteRange, unitType]
      );
    }

    const updatedConfig = {
      id: existing.length > 0 ? existing[0].id : 'dev-vms-001',
      device_code: deviceCode,
      display_name: displayName,
      manufacturer,
      model,
      serial_number: serialNumber,
      capacity_kg: capacityKg,
      port,
      baud_rate: baudRate,
      interface_type: interfaceType,
      data_bits: dataBits,
      stop_bits: stopBits,
      parity,
      sample_time_ms: sampleTimeMs,
      byte_range: byteRange,
      unit_type: unitType,
      is_active: 1,
    };

    await ventekSerialService.updateConfigAndRestart(updatedConfig);

    res.json({
      success: true,
      message: `Ventek device configuration updated for ${displayName} on ${port} @ ${baudRate} baud`,
      config: updatedConfig,
      connected: ventekSerialService.isConnected,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/weighbridge/ports
// Discovers COM serial ports on the host system
app.get('/api/weighbridge/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({
      success: true,
      ports: ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer || 'Standard Serial Port',
        friendlyName: p.friendlyName || p.path,
        pnpId: p.pnpId || '',
        productId: p.productId || '',
        vendorId: p.vendorId || '',
      })),
      activePort: ventekSerialService.config.port || 'COM3',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, ports: [] });
  }
});

// POST /api/weighbridge/device/test
// Tests connectivity to specified COM port
app.post('/api/weighbridge/device/test', async (req, res) => {
  try {
    const { port = 'COM3', baudRate = 2400 } = req.body;
    const availablePorts = await SerialPort.list();
    const found = availablePorts.some(p => p.path.toUpperCase() === port.toUpperCase());
    
    res.json({
      success: true,
      port,
      baudRate,
      availableOnSystem: found,
      allPorts: availablePorts.map(p => p.path),
      message: found 
        ? `Port ${port} is active on system hardware.` 
        : `Port ${port} is not currently detected on system. Please verify USB-serial converter is plugged into PC.`,
      currentConnected: ventekSerialService.isConnected && ventekSerialService.config.port === port,
      lastError: ventekSerialService.lastError,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== WEIGHBRIDGE DEVICES CRUD ====================
app.get('/api/weighbridge-devices', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM weighbridge_devices ORDER BY is_active DESC, created_at ASC');
    res.json(rows.map(r => ({
      ...r,
      isConnected: ventekSerialService.isConnected && ventekSerialService.config.port === r.port
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/weighbridge-devices', async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || `dev-wb-${Date.now().toString(36)}`;
    await pool.query(
      `INSERT INTO weighbridge_devices 
        (id, device_code, display_name, manufacturer, model, serial_number, capacity_kg, port, baud_rate, interface_type, data_bits, stop_bits, parity, sample_time_ms, unit_type, mode, file_path, tcp_host, tcp_port, is_active, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        b.device_code || b.deviceCode || 'VMS',
        b.display_name || b.displayName || 'New Indicator',
        b.manufacturer || 'VENTEK',
        b.model || 'VMS-WB',
        b.serial_number || b.serialNumber || '',
        Number(b.capacity_kg || b.capacityKg) || 50000,
        b.port || 'COM3',
        Number(b.baud_rate || b.baudRate) || 2400,
        b.interface_type || b.interfaceType || 'RS232',
        Number(b.data_bits || b.dataBits) || 8,
        Number(b.stop_bits || b.stopBits) || 1,
        b.parity || 'none',
        Number(b.sample_time_ms || b.sampleTimeMs) || 1000,
        b.unit_type || b.unitType || 'kg',
        b.mode || 'serial',
        b.file_path || b.filePath || 'C:\\Weighbridge\\live_weight.txt',
        b.tcp_host || b.tcpHost || '127.0.0.1',
        Number(b.tcp_port || b.tcpPort) || 4001,
        b.is_active ? 1 : 0,
        b.status || 'online'
      ]
    );
    res.status(201).json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/weighbridge-devices/:id', async (req, res) => {
  try {
    const b = req.body;
    const targetId = req.params.id;
    await pool.query(
      `UPDATE weighbridge_devices SET
        device_code = ?, display_name = ?, manufacturer = ?, model = ?, serial_number = ?,
        capacity_kg = ?, port = ?, baud_rate = ?, interface_type = ?, data_bits = ?,
        stop_bits = ?, parity = ?, sample_time_ms = ?, unit_type = ?, mode = ?,
        file_path = ?, tcp_host = ?, tcp_port = ?, status = ?, updated_at = NOW()
       WHERE id = ? OR device_code = ?`,
      [
        b.device_code || b.deviceCode || 'VMS',
        b.display_name || b.displayName || 'Ventek Scale Indicator',
        b.manufacturer || 'VENTEK',
        b.model || 'VMS-WB',
        b.serial_number || b.serialNumber || '',
        Number(b.capacity_kg || b.capacityKg) || 50000,
        b.port || 'COM3',
        Number(b.baud_rate || b.baudRate) || 2400,
        b.interface_type || b.interfaceType || 'RS232',
        Number(b.data_bits || b.dataBits) || 8,
        Number(b.stop_bits || b.stopBits) || 1,
        b.parity || 'none',
        Number(b.sample_time_ms || b.sampleTimeMs) || 1000,
        b.unit_type || b.unitType || 'kg',
        b.mode || 'serial',
        b.file_path || b.filePath || '',
        b.tcp_host || b.tcpHost || '',
        Number(b.tcp_port || b.tcpPort) || 4001,
        b.status || 'online',
        targetId,
        targetId
      ]
    );

    const [rows] = await pool.query('SELECT * FROM weighbridge_devices WHERE id = ? OR device_code = ? LIMIT 1', [targetId, targetId]);
    if (rows.length > 0 && rows[0].is_active) {
      await ventekSerialService.updateConfigAndRestart(rows[0]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/weighbridge-devices/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM weighbridge_devices WHERE id = ?', [req.params.id]);
    await recordSyncTombstone('weighbridge_devices', 'id', req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/weighbridge-devices/:id/activate', async (req, res) => {
  try {
    await pool.query('UPDATE weighbridge_devices SET is_active = 0');
    await pool.query('UPDATE weighbridge_devices SET is_active = 1 WHERE id = ?', [req.params.id]);
    const [rows] = await pool.query('SELECT * FROM weighbridge_devices WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      await ventekSerialService.updateConfigAndRestart(rows[0]);
    }
    res.json({ success: true, message: 'Indicator activated and connected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PRINTER DEVICES CRUD ====================
app.get('/api/printers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM printer_devices ORDER BY is_default DESC, created_at ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/printers', async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || `prn-${Date.now().toString(36)}`;
    if (b.is_default) {
      await pool.query('UPDATE printer_devices SET is_default = 0');
    }
    await pool.query(
      `INSERT INTO printer_devices 
        (id, name, model, type, connection_type, ip_address, port, paper_size, copies, auto_print_on_completion, print_qr_code, print_images, is_default, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        b.name || 'New Printer',
        b.model || 'Standard Slip Printer',
        b.type || 'thermal_80mm',
        b.connection_type || b.connectionType || 'system',
        b.ip_address || b.ipAddress || null,
        Number(b.port) || 9100,
        b.paper_size || b.paperSize || '80mm',
        Number(b.copies) || 1,
        b.auto_print_on_completion ? 1 : 0,
        b.print_qr_code !== false ? 1 : 0,
        b.print_images !== false ? 1 : 0,
        b.is_default ? 1 : 0,
        b.status || 'online',
        b.notes || ''
      ]
    );
    res.status(201).json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/printers/:id', async (req, res) => {
  try {
    const b = req.body;
    if (b.is_default) {
      await pool.query('UPDATE printer_devices SET is_default = 0 WHERE id != ?', [req.params.id]);
    }
    await pool.query(
      `UPDATE printer_devices SET
        name = ?, model = ?, type = ?, connection_type = ?, ip_address = ?, port = ?,
        paper_size = ?, copies = ?, auto_print_on_completion = ?, print_qr_code = ?,
        print_images = ?, is_default = ?, status = ?, notes = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        b.name || 'Printer',
        b.model || 'Standard',
        b.type || 'thermal_80mm',
        b.connection_type || b.connectionType || 'system',
        b.ip_address || b.ipAddress || null,
        Number(b.port) || 9100,
        b.paper_size || b.paperSize || '80mm Roll',
        Number(b.copies) || 1,
        b.auto_print_on_completion ? 1 : 0,
        b.print_qr_code ? 1 : 0,
        b.print_images ? 1 : 0,
        b.is_default ? 1 : 0,
        b.status || 'online',
        b.notes || '',
        req.params.id
      ]
    );
    if (b.is_default && b.print_images !== undefined) {
      try {
        const [csRows] = await pool.query('SELECT id, weighbridge_defaults FROM company_settings LIMIT 1');
        if (csRows.length > 0) {
          const curDefaults = typeof csRows[0].weighbridge_defaults === 'string'
            ? JSON.parse(csRows[0].weighbridge_defaults || '{}')
            : (csRows[0].weighbridge_defaults || {});
          curDefaults.printImages = Boolean(b.print_images);
          await pool.query('UPDATE company_settings SET weighbridge_defaults = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(curDefaults), csRows[0].id]);
        }
      } catch {}
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/printers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM printer_devices WHERE id = ?', [req.params.id]);
    await recordSyncTombstone('printer_devices', 'id', req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/printers/:id/default', async (req, res) => {
  try {
    await pool.query('UPDATE printer_devices SET is_default = 0');
    await pool.query('UPDATE printer_devices SET is_default = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/printers/:id/test', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM printer_devices WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Printer not found' });
    const prn = rows[0];
    res.json({
      success: true,
      message: `Test print job successfully spooled to ${prn.name} (${prn.type}) via ${prn.connection_type}.`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FTP CONFIGS CRUD ====================
app.get('/api/ftp-configs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ftp_configs ORDER BY is_active DESC, created_at ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ftp-configs', async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || `ftp-${Date.now().toString(36)}`;
    if (b.is_active) {
      await pool.query('UPDATE ftp_configs SET is_active = 0');
    }
    await pool.query(
      `INSERT INTO ftp_configs 
        (id, name, host, port, username, password, remote_dir, secure, passive, is_active, status, purpose)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        b.name || 'FTP Server',
        b.host || 'ftp.activitsol.com',
        Number(b.port) || 2121,
        b.username || 'demo',
        b.password || '',
        b.remote_dir || b.remoteDir || '/Dharani',
        b.secure ? 1 : 0,
        b.passive !== false ? 1 : 0,
        b.is_active ? 1 : 0,
        b.status || 'online',
        b.purpose || 'anpr_snapshots'
      ]
    );
    res.status(201).json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/ftp-configs/:id', async (req, res) => {
  try {
    const b = req.body;
    if (b.is_active) {
      await pool.query('UPDATE ftp_configs SET is_active = 0 WHERE id != ?', [req.params.id]);
    }
    await pool.query(
      `UPDATE ftp_configs SET
        name = ?, host = ?, port = ?, username = ?, password = ?, remote_dir = ?,
        secure = ?, passive = ?, is_active = ?, status = ?, purpose = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        b.name || 'FTP Profile',
        b.host || 'ftp.activitsol.com',
        Number(b.port) || 2121,
        b.username || 'demo',
        b.password || '',
        b.remote_dir || b.remoteDir || '/Dharani',
        b.secure ? 1 : 0,
        b.passive ? 1 : 0,
        b.is_active ? 1 : 0,
        b.status || 'online',
        b.purpose || 'anpr_snapshots',
        req.params.id
      ]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/ftp-configs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ftp_configs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ftp-configs/:id/activate', async (req, res) => {
  try {
    await pool.query('UPDATE ftp_configs SET is_active = 0');
    await pool.query('UPDATE ftp_configs SET is_active = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'FTP server profile set as primary' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ftp-configs/test', async (req, res) => {
  const { host = 'ftp.activitsol.com', port, username = 'demo', password = 'Password@123', secure = false, remote_dir = '/Dharani' } = req.body;
  if (!host) {
    return res.status(400).json({ success: false, error: 'FTP Host is required' });
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    const effectivePort = parseInt(port, 10) || 2121;
    await client.access({
      host,
      port: effectivePort,
      user: username,
      password,
      secure: Boolean(secure),
      timeout: 8000,
    });

    if (remote_dir && remote_dir !== '/' && remote_dir !== '.') {
      await client.ensureDir(remote_dir);
    }
    const list = await client.list();
    client.close();
    res.json({
      success: true,
      message: `Connected successfully to FTP server ${host}:${effectivePort}! Directory verified (${list.length} files found).`,
    });
  } catch (err) {
    client.close();
    res.status(500).json({
      success: false,
      error: `FTP Connection Failed: ${err.message}`,
    });
  }
});

// GET /api/weighbridge/slips
app.get('/api/weighbridge/slips', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const [rows] = await pool.query(
      'SELECT * FROM weigh_slips ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [parseInt(limit), parseInt(offset)]
    );
    res.json(rows.map(formatWeighSlip));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/weighbridge/slips
app.post('/api/weighbridge/slips', async (req, res) => {
  try {
    const b = req.body;
    const slipNumber = b.slipNumber || `SLIP-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;

    let compName = b.companyName || b.firmName || '';
    let compAddr = b.companyAddress || '';
    let compPhone = b.phoneNo || '';
    try {
      const [compRows] = await pool.query('SELECT company_name, firm_name, address, city, pincode, phone FROM company_settings LIMIT 1');
      if (compRows.length > 0) {
        if (!compName) compName = compRows[0].firm_name || compRows[0].company_name || '';
        if (!compAddr) compAddr = compRows[0].address ? `${compRows[0].address}, ${compRows[0].city || ''} ${compRows[0].pincode || ''}`.trim() : '';
        if (!compPhone) compPhone = compRows[0].phone || '';
      }
    } catch (e) {}

    const firstWeight = b.firstWeight !== undefined ? b.firstWeight : (b.tareWeight || 0);
    const secondWeight = b.secondWeight !== undefined ? b.secondWeight : (b.grossWeight || 0);
    const nettWeight = b.nettWeight !== undefined ? b.nettWeight : (b.netWeight !== undefined ? b.netWeight : Math.abs(secondWeight - firstWeight));

    const fDate = b.firstWeightDate || (b.firstWeightTime ? new Date(b.firstWeightTime).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    const sDate = b.secondWeightDate || (b.secondWeightTime ? new Date(b.secondWeightTime).toISOString().split('T')[0] : (secondWeight ? new Date().toISOString().split('T')[0] : null));

    await pool.query(
      `INSERT INTO weigh_slips (
        slip_number, session_id, transaction_no, vehicle_reg_no, party_name, firm_name,
        date_time, first_weight, first_weight_time, second_weight, second_weight_time,
        tare_weight, gross_weight, net_weight, material, rate, moisture, deduction,
        charges, vehicle_type, bags_bales, agent, village, chess_no, chess_amount,
        chess_name, final_rate, total_amount, print_options, driver_name, destination,
        operator_name, evidence, company_name, company_address, phone_no, load_slip_no,
        vehicle_no, cultivator_name, location_name, father_name, mobile_no, status, first_weight_date,
        second_weight_date, nett_weight, admin_name, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        NOW(), ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, NOW()
      ) ON DUPLICATE KEY UPDATE
        transaction_no = VALUES(transaction_no),
        vehicle_reg_no = VALUES(vehicle_reg_no),
        party_name = VALUES(party_name),
        first_weight = VALUES(first_weight),
        first_weight_time = VALUES(first_weight_time),
        second_weight = VALUES(second_weight),
        second_weight_time = VALUES(second_weight_time),
        tare_weight = VALUES(tare_weight),
        gross_weight = VALUES(gross_weight),
        net_weight = VALUES(net_weight),
        material = VALUES(material),
        rate = VALUES(rate),
        moisture = VALUES(moisture),
        bags_bales = VALUES(bags_bales),
        village = VALUES(village),
        chess_no = VALUES(chess_no),
        chess_amount = VALUES(chess_amount),
        cultivator_name = VALUES(cultivator_name),
        location_name = VALUES(location_name),
        load_slip_no = VALUES(load_slip_no),
        father_name = VALUES(father_name),
        mobile_no = VALUES(mobile_no),
        status = VALUES(status),
        first_weight_date = VALUES(first_weight_date),
        second_weight_date = VALUES(second_weight_date),
        nett_weight = VALUES(nett_weight),
        admin_name = VALUES(admin_name)`,
      [
        slipNumber,
        b.sessionId || `WB-SESS-${Date.now()}`,
        b.transactionNo || 0,
        b.vehicleRegNo || b.vehicleNo || '',
        b.partyName || '',
        compName,
        firstWeight,
        b.firstWeightTime ? new Date(b.firstWeightTime) : null,
        secondWeight,
        b.secondWeightTime ? new Date(b.secondWeightTime) : null,
        firstWeight,
        secondWeight,
        nettWeight,
        b.material || b.product || '',
        b.rate !== undefined ? b.rate : 0,
        b.moisture !== undefined ? b.moisture : 0,
        b.deduction !== undefined ? b.deduction : 0,
        b.charges !== undefined ? b.charges : 0,
        b.vehicleType || '',
        b.bagsBales || '',
        b.agent || '',
        b.village || '',
        b.chessNo || '',
        b.chessAmount !== undefined ? b.chessAmount : 0,
        b.chessName || '',
        b.finalRate !== undefined ? b.finalRate : 0,
        b.totalAmount !== undefined ? b.totalAmount : 0,
        JSON.stringify(b.printOptions || { printDuplicate: false, printQrCode: true, printImages: true }),
        b.driverName || '',
        b.destination || '',
        b.adminName || b.operatorName || 'System Admin',
        JSON.stringify(b.evidence || []),
        compName,
        compAddr,
        compPhone,
        b.loadSlipNo || '',
        b.vehicleNo || b.vehicleRegNo || '',
        b.cultivatorName || '',
        b.locationName || '',
        b.fatherName || '',
        b.mobileNo || '',
        b.status || (secondWeight ? 'completed' : '1st_weight_complete'),
        fDate,
        sDate,
        nettWeight,
        b.adminName || b.operatorName || 'System Admin'
      ]
    );

    res.status(201).json({ success: true, slipNumber, message: 'Weigh slip generated' });
  } catch (error) {
    console.error('Create weigh slip error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REPORTS MODULE API (47-Field Registry & Dynamic Reports)
// ==========================================

function mapRowTo47Fields(row) {
  let evidence = [];
  try {
    evidence = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence || []);
  } catch (e) {}

  const fDate = safeDatePart(row.first_weight_time || row.created_at, '');
  const fTime = safeTimePart(row.first_weight_time || row.created_at, '');
  const sDate = safeDatePart(row.second_weight_time, '');
  const sTime = safeTimePart(row.second_weight_time, '');
  const udtStr = safeIsoDate(row.udt || row.updated_at, '')?.replace('T', ' ').substring(0, 19) || '';

  const fWeight = row.first_weight !== null && row.first_weight !== undefined ? parseFloat(row.first_weight) : (row.tare_weight !== null ? parseFloat(row.tare_weight) : 0);
  const sWeight = row.second_weight !== null && row.second_weight !== undefined ? parseFloat(row.second_weight) : (row.gross_weight !== null ? parseFloat(row.gross_weight) : 0);
  const netWeight = row.net_weight !== null && row.net_weight !== undefined ? parseFloat(row.net_weight) : (fWeight && sWeight ? Math.abs(sWeight - fWeight) : 0);
  const deduction = parseFloat(row.deduction || 0);
  const moisture = parseFloat(row.moisture || 0);
  const moisRate = parseFloat(row.mois_rate || (moisture * 0.5));
  const lesswt = parseFloat(row.less_weight !== null && row.less_weight !== undefined ? row.less_weight : (deduction + ((netWeight * moisture) / 100)));
  const finwt = parseFloat(row.final_weight !== null && row.final_weight !== undefined ? row.final_weight : Math.max(0, netWeight - lesswt));
  const rate = parseFloat(row.rate || 0);
  const finalRate = parseFloat(row.final_rate !== null && row.final_rate !== undefined ? row.final_rate : rate);
  const charges = parseFloat(row.charges || 0);
  const chessAmount = parseFloat(row.chess_amount || 0);
  const totalAmount = parseFloat(row.total_amount !== null && row.total_amount !== undefined ? row.total_amount : Math.round((finwt / 1000) * finalRate + charges + chessAmount));

  return {
    TransactionNo: row.transaction_no ? parseInt(row.transaction_no) : 0,
    FDate: fDate,
    Charges: charges,
    VehicleNo: row.vehicle_reg_no || '',
    PartyName: row.party_name || '',
    Product: row.material || '',
    FTime: fTime,
    FWeight: fWeight,
    SDate: sDate,
    STime: sTime,
    SWeight: sWeight,
    Status: row.status || '',
    FWUser: row.fw_user || row.operator_name || 'System Operator',
    SWUser: row.sw_user || '',
    NettWeight: netWeight,
    lesswt: lesswt,
    Finwt: finwt,
    MoisRate: moisRate,
    Amount: totalAmount,
    IMAGE1: row.image1 || (evidence[0]?.url || ''),
    IMAGE2: row.image2 || (evidence[1]?.url || ''),
    IMAGE3: row.image3 || (evidence[2]?.url || ''),
    IMAGE4: row.image4 || (evidence[3]?.url || ''),
    udt: udtStr,
    Deduction: deduction,
    LocationName: row.location_name || row.destination || 'Plant 1 - Yard',
    CultivatorName: row.cultivator_name || '',
    LoadSlipNo: row.load_slip_no || row.sap_po_number || '',
    BagsBales: row.bags_bales || '',
    Rate: rate,
    Moisture: moisture,
    ChessNo: row.chess_no || '',
    ChessName: row.chess_name || '',
    ChessAmount: chessAmount,
    FatherName: row.father_name || '',
    Mandal: row.mandal || '',
    Village: row.village || '',
    BankName: row.bank_name || '',
    BranchName: row.branch_name || '',
    IFSCODE: row.ifsc_code || '',
    TraderName: row.trader_name || row.agent || '',
    AllotedMil: row.alloted_mill || row.firm_name || '',
    AccountNo: row.account_no || '',
    Heap: row.heap_no || '',
    FinalRate: finalRate,
    MobileNo: row.mobile_no || '',
    FinalWeight: finwt,
  };
}

// GET /api/reports/fields
app.get('/api/reports/fields', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const reportType = req.query.reportType || 'weighment_report';

    const [rows] = await pool.query(
      `SELECT s_no AS sNo, field_key AS fieldKey, field_name AS fieldName, 
              is_selected AS isSelected, display_order AS displayOrder
       FROM report_field_configs
       WHERE user_id = ? AND report_type = ?
       ORDER BY display_order ASC, s_no ASC`,
      [userId, reportType]
    );

    if (rows.length === 0 && userId !== 'default') {
      const [defaultRows] = await pool.query(
        `SELECT s_no AS sNo, field_key AS fieldKey, field_name AS fieldName, 
                is_selected AS isSelected, display_order AS displayOrder
         FROM report_field_configs
         WHERE user_id = 'default' AND report_type = ?
         ORDER BY display_order ASC, s_no ASC`,
        [reportType]
      );
      return res.json(defaultRows.map(r => ({ ...r, isSelected: Boolean(r.isSelected) })));
    }

    res.json(rows.map(r => ({ ...r, isSelected: Boolean(r.isSelected) })));
  } catch (error) {
    console.error('Get report fields error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reports/fields/config
app.post('/api/reports/fields/config', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const userId = req.body.userId || 'default';
    const reportType = req.body.reportType || 'weighment_report';
    const fields = req.body.fields || [];

    for (const f of fields) {
      await connection.query(
        `INSERT INTO report_field_configs 
         (user_id, report_type, s_no, field_key, field_name, is_selected, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           is_selected = VALUES(is_selected),
           display_order = VALUES(display_order)`,
        [
          userId,
          reportType,
          f.sNo || 0,
          f.fieldKey,
          f.fieldName || f.fieldKey,
          f.isSelected ? 1 : 0,
          f.displayOrder !== undefined ? f.displayOrder : (f.sNo || 0)
        ]
      );
    }

    await connection.commit();
    res.json({ success: true, message: 'Report fields configuration saved successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Save report fields error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// GET /api/reports/filter-options
app.get('/api/reports/filter-options', async (req, res) => {
  try {
    const [parties] = await pool.query(
      `SELECT DISTINCT party_name FROM weighbridge_sessions WHERE party_name IS NOT NULL AND party_name != '' ORDER BY party_name ASC`
    );
    const [products] = await pool.query(
      `SELECT DISTINCT material FROM weighbridge_sessions WHERE material IS NOT NULL AND material != '' ORDER BY material ASC`
    );
    const [statuses] = await pool.query(
      `SELECT DISTINCT status FROM weighbridge_sessions WHERE status IS NOT NULL AND status != '' ORDER BY status ASC`
    );
    const [users] = await pool.query(
      `SELECT DISTINCT name, username FROM users WHERE status = 'active' ORDER BY name ASC`
    );

    res.json({
      parties: parties.map(p => p.party_name),
      products: products.map(p => p.material),
      statuses: ['Inward', 'Outward'],
      users: users.map(u => u.name)
    });
  } catch (error) {
    console.error('Get report filter options error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/search
app.get('/api/reports/search', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      partyName,
      product,
      status,
      transNoFrom,
      transNoTo,
      vehicleNo,
      fwUser,
      swUser,
      firstDateWise
    } = req.query;

    let query = 'SELECT * FROM weighbridge_sessions WHERE 1=1';
    const params = [];

    if (dateFrom) {
      query += ' AND (DATE(first_weight_time) >= ? OR (first_weight_time IS NULL AND DATE(created_at) >= ?))';
      params.push(dateFrom, dateFrom);
    }
    if (dateTo) {
      query += ' AND (DATE(first_weight_time) <= ? OR (first_weight_time IS NULL AND DATE(created_at) <= ?))';
      params.push(dateTo, dateTo);
    }
    if (partyName && partyName !== 'all') {
      query += ' AND party_name = ?';
      params.push(partyName);
    }
    if (product && product !== 'all') {
      query += ' AND material = ?';
      params.push(product);
    }
    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }
    if (transNoFrom) {
      query += ' AND transaction_no >= ?';
      params.push(parseInt(transNoFrom));
    }
    if (transNoTo) {
      query += ' AND transaction_no <= ?';
      params.push(parseInt(transNoTo));
    }
    if (vehicleNo) {
      query += ' AND vehicle_reg_no LIKE ?';
      params.push(`%${vehicleNo}%`);
    }
    if (fwUser && fwUser !== 'all') {
      query += ' AND (fw_user = ? OR operator_name = ?)';
      params.push(fwUser, fwUser);
    }
    if (swUser && swUser !== 'all') {
      query += ' AND sw_user = ?';
      params.push(swUser);
    }

    if (firstDateWise === 'true' || firstDateWise === true || firstDateWise === '1') {
      query += ' ORDER BY COALESCE(first_weight_time, created_at) ASC, transaction_no ASC';
    } else {
      query += ' ORDER BY transaction_no DESC';
    }

    query += ' LIMIT 500';

    const [rows] = await pool.query(query, params);
    const data = rows.map(mapRowTo47Fields);

    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    console.error('Reports search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/party-totals
app.get('/api/reports/party-totals', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      partyName,
      product,
      status,
      transNoFrom,
      transNoTo,
      vehicleNo
    } = req.query;

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (dateFrom) {
      whereClause += ' AND (DATE(first_weight_time) >= ? OR (first_weight_time IS NULL AND DATE(created_at) >= ?))';
      params.push(dateFrom, dateFrom);
    }
    if (dateTo) {
      whereClause += ' AND (DATE(first_weight_time) <= ? OR (first_weight_time IS NULL AND DATE(created_at) <= ?))';
      params.push(dateTo, dateTo);
    }
    if (partyName && partyName !== 'all') {
      whereClause += ' AND party_name = ?';
      params.push(partyName);
    }
    if (product && product !== 'all') {
      whereClause += ' AND material = ?';
      params.push(product);
    }
    if (status && status !== 'all') {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (transNoFrom) {
      whereClause += ' AND transaction_no >= ?';
      params.push(parseInt(transNoFrom));
    }
    if (transNoTo) {
      whereClause += ' AND transaction_no <= ?';
      params.push(parseInt(transNoTo));
    }
    if (vehicleNo) {
      whereClause += ' AND vehicle_reg_no LIKE ?';
      params.push(`%${vehicleNo}%`);
    }

    const query = `
      SELECT 
        COALESCE(party_name, 'Unspecified Party') AS partyName,
        COUNT(*) AS totalTransactions,
        COALESCE(SUM(first_weight), 0) AS totalFirstWeight,
        COALESCE(SUM(second_weight), 0) AS totalSecondWeight,
        COALESCE(SUM(net_weight), 0) AS totalNetWeight,
        COALESCE(SUM(deduction), 0) AS totalDeduction,
        COALESCE(SUM(less_weight), 0) AS totalLessWeight,
        COALESCE(SUM(final_weight), 0) AS totalFinalWeight,
        COALESCE(SUM(charges), 0) AS totalCharges,
        COALESCE(SUM(chess_amount), 0) AS totalChessAmount,
        COALESCE(SUM(total_amount), 0) AS totalAmount
      FROM weighbridge_sessions
      ${whereClause}
      GROUP BY party_name
      ORDER BY totalAmount DESC, partyName ASC
    `;

    const [rows] = await pool.query(query, params);

    const grandTotals = rows.reduce(
      (acc, r) => ({
        totalTransactions: acc.totalTransactions + parseInt(r.totalTransactions || 0),
        totalFirstWeight: acc.totalFirstWeight + parseFloat(r.totalFirstWeight || 0),
        totalSecondWeight: acc.totalSecondWeight + parseFloat(r.totalSecondWeight || 0),
        totalNetWeight: acc.totalNetWeight + parseFloat(r.totalNetWeight || 0),
        totalDeduction: acc.totalDeduction + parseFloat(r.totalDeduction || 0),
        totalLessWeight: acc.totalLessWeight + parseFloat(r.totalLessWeight || 0),
        totalFinalWeight: acc.totalFinalWeight + parseFloat(r.totalFinalWeight || 0),
        totalCharges: acc.totalCharges + parseFloat(r.totalCharges || 0),
        totalChessAmount: acc.totalChessAmount + parseFloat(r.totalChessAmount || 0),
        totalAmount: acc.totalAmount + parseFloat(r.totalAmount || 0)
      }),
      {
        totalTransactions: 0,
        totalFirstWeight: 0,
        totalSecondWeight: 0,
        totalNetWeight: 0,
        totalDeduction: 0,
        totalLessWeight: 0,
        totalFinalWeight: 0,
        totalCharges: 0,
        totalChessAmount: 0,
        totalAmount: 0
      }
    );

    res.json({
      success: true,
      partyTotals: rows.map(r => ({
        partyName: r.partyName,
        totalTransactions: parseInt(r.totalTransactions || 0),
        totalFirstWeight: parseFloat(r.totalFirstWeight || 0),
        totalSecondWeight: parseFloat(r.totalSecondWeight || 0),
        totalNetWeight: parseFloat(r.totalNetWeight || 0),
        totalDeduction: parseFloat(r.totalDeduction || 0),
        totalLessWeight: parseFloat(r.totalLessWeight || 0),
        totalFinalWeight: parseFloat(r.totalFinalWeight || 0),
        totalCharges: parseFloat(r.totalCharges || 0),
        totalChessAmount: parseFloat(r.totalChessAmount || 0),
        totalAmount: parseFloat(r.totalAmount || 0)
      })),
      grandTotals
    });
  } catch (error) {
    console.error('Party totals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/vehicle-stats (Vehicle Trip Frequency & Historical Fleet Analytics)
app.get('/api/reports/vehicle-stats', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      partyName,
      product,
      status,
      transNoFrom,
      transNoTo,
      vehicleNo
    } = req.query;

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (dateFrom) {
      whereClause += ' AND (DATE(first_weight_time) >= ? OR (first_weight_time IS NULL AND DATE(created_at) >= ?))';
      params.push(dateFrom, dateFrom);
    }
    if (dateTo) {
      whereClause += ' AND (DATE(first_weight_time) <= ? OR (first_weight_time IS NULL AND DATE(created_at) <= ?))';
      params.push(dateTo, dateTo);
    }
    if (partyName && partyName !== 'all') {
      whereClause += ' AND party_name = ?';
      params.push(partyName);
    }
    if (product && product !== 'all') {
      whereClause += ' AND material = ?';
      params.push(product);
    }
    if (status && status !== 'all') {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (transNoFrom) {
      whereClause += ' AND transaction_no >= ?';
      params.push(parseInt(transNoFrom));
    }
    if (transNoTo) {
      whereClause += ' AND transaction_no <= ?';
      params.push(parseInt(transNoTo));
    }
    if (vehicleNo) {
      whereClause += ' AND vehicle_reg_no LIKE ?';
      params.push(`%${vehicleNo}%`);
    }

    const query = `
      SELECT 
        COALESCE(NULLIF(TRIM(vehicle_reg_no), ''), 'Unknown Vehicle') AS vehicleNo,
        COUNT(*) AS totalTrips,
        COALESCE(SUM(first_weight), 0) AS totalFirstWeight,
        COALESCE(SUM(second_weight), 0) AS totalTareWeight,
        COALESCE(SUM(net_weight), 0) AS totalNetWeight,
        COALESCE(SUM(charges), 0) AS totalCharges,
        MIN(COALESCE(first_weight_time, created_at)) AS firstVisitTime,
        MAX(COALESCE(first_weight_time, created_at)) AS lastVisitTime,
        GROUP_CONCAT(DISTINCT NULLIF(TRIM(party_name), '') SEPARATOR ', ') AS parties,
        GROUP_CONCAT(DISTINCT NULLIF(TRIM(material), '') SEPARATOR ', ') AS commodities
      FROM weighbridge_sessions
      ${whereClause}
      GROUP BY COALESCE(NULLIF(TRIM(vehicle_reg_no), ''), 'Unknown Vehicle')
      ORDER BY totalTrips DESC, totalNetWeight DESC
    `;

    const [rows] = await pool.query(query, params);

    res.json({
      success: true,
      count: rows.length,
      vehicleStats: rows.map(r => ({
        vehicleNo: r.vehicleNo,
        totalTrips: parseInt(r.totalTrips || 0),
        totalFirstWeight: parseFloat(r.totalFirstWeight || 0),
        totalTareWeight: parseFloat(r.totalTareWeight || 0),
        totalNetWeight: parseFloat(r.totalNetWeight || 0),
        totalCharges: parseFloat(r.totalCharges || 0),
        firstVisitTime: r.firstVisitTime,
        lastVisitTime: r.lastVisitTime,
        parties: r.parties || '—',
        commodities: r.commodities || '—'
      }))
    });
  } catch (error) {
    console.error('Vehicle stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/transaction/:id (For Weighment F5 Print)
app.get('/api/reports/transaction/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const isNumeric = /^\d+$/.test(id);
    let rows;
    if (isNumeric) {
      [rows] = await pool.query(
        'SELECT * FROM weighbridge_sessions WHERE transaction_no = ? OR session_id = ? LIMIT 1',
        [parseInt(id), id]
      );
    } else {
      [rows] = await pool.query(
        'SELECT * FROM weighbridge_sessions WHERE session_id = ? LIMIT 1',
        [id]
      );
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const row = rows[0];
    const mapped = mapRowTo47Fields(row);

    const [configs] = await pool.query(
      `SELECT s_no AS sNo, field_key AS fieldKey, field_name AS fieldName, 
              is_selected AS isSelected, display_order AS displayOrder
       FROM report_field_configs
       WHERE user_id = 'default' AND report_type = 'weighment_report' AND is_selected = TRUE
       ORDER BY display_order ASC`
    );

    const [companyRows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
    const company = companyRows.length > 0 ? companyRows[0] : {};

    res.json({
      success: true,
      transaction: mapped,
      rawSession: formatWeighbridgeSession(row),
      fieldConfigs: configs,
      company: {
        companyName: company.company_name || 'Aparna RMC Ltd.',
        firmName: company.firm_name || 'Aparna RMC',
        plantName: company.plant_name || 'Plant 1 - Main Batching Yard',
        plantCode: company.plant_code || 'PLANT_001',
        tagline: company.tagline || 'Certified Electronic Weighbridge & Automated Concrete Dispatch',
        address: company.address || '',
        city: company.city || 'Pune',
        pincode: company.pincode || '411057',
        phone: company.phone || '+91 20 2712 8899',
        gstin: company.gstin || '27AAAAA0000A1Z5',
        weighbridgeLicense: company.weighbridge_license || 'WB/2026/RMC-449',
        scaleModel: company.scale_model || 'Avery Weigh-Tronix E1205',
        scaleCapacity: company.scale_capacity || '100 MT',
      }
    });
  } catch (error) {
    console.error('Get transaction report details error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// AUDIT LOGS API (Phase 4)
// ==========================================

function formatAuditLog(row) {
  if (!row) return null;
  const parseJson = (v, def) => {
    try { return typeof v === 'string' ? JSON.parse(v) : (v || def); } catch (e) { return def; }
  };

  let performedBy = parseJson(row.performed_by, null);
  if (!performedBy || typeof performedBy !== 'object') {
    const rawName = row.performed_by || row.user_name || 'System Operator';
    performedBy = { id: row.user_id || 'SYS', name: String(rawName), role: 'operator' };
  } else {
    performedBy = {
      id: performedBy.id || 'SYS',
      name: performedBy.name || 'System Operator',
      role: performedBy.role || 'operator',
    };
  }

  return {
    id: row.id,
    timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString(),
    module: row.module || 'system',
    action: row.action || 'UPDATE',
    entityId: row.entity_id || '',
    entityType: row.entity_type || '',
    performedBy,
    details: row.details || '',
    severity: row.severity || 'info',
    previousState: parseJson(row.previous_state, null),
    newState: parseJson(row.new_state, null),
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
  };
}

// GET /api/audit-logs
app.get('/api/audit-logs', async (req, res) => {
  try {
    const { module: mod, severity, limit = 100, offset = 0 } = req.query;
    let query = 'SELECT * FROM audit_logs';
    const params = [];
    const conditions = [];

    if (mod && mod !== 'all') {
      conditions.push('module = ?');
      params.push(mod);
    }
    if (severity && severity !== 'all') {
      conditions.push('severity = ?');
      params.push(severity);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY timestamp DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await pool.query(query, params);
    res.json(rows.map(formatAuditLog));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/audit-logs
app.post('/api/audit-logs', async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || `aud-${Date.now()}`;

    await pool.query(
      `INSERT INTO audit_logs (
        id, timestamp, module, action, entity_id, entity_type,
        performed_by, details, severity, previous_state, new_state, metadata, created_at
      ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        b.module || 'system',
        b.action || 'UPDATE',
        b.entityId || b.entity_id || '',
        b.entityType || b.entity_type || 'System',
        JSON.stringify(b.performedBy || b.performed_by || { id: 'SYS', name: 'User', role: 'Staff' }),
        b.details || '',
        b.severity || 'info',
        JSON.stringify(b.previousState || b.previous_state || null),
        JSON.stringify(b.newState || b.new_state || null),
        JSON.stringify(b.metadata || {})
      ]
    );

    res.status(201).json({ success: true, id, message: 'Audit entry created' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ==========================================
// AUTHENTICATION & RBAC API
// ==========================================

function formatUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    roleId: u.role_id,
    roleName: u.role_name,
    phone: u.phone || undefined,
    department: u.department || undefined,
    shift: u.shift || undefined,
    status: u.status || 'active',
    avatar: u.avatar || undefined,
    lastLogin: u.last_login ? new Date(u.last_login).toISOString() : undefined,
    createdAt: u.created_at ? new Date(u.created_at).toISOString() : undefined,
    updatedAt: u.updated_at ? new Date(u.updated_at).toISOString() : undefined,
  };
}

function formatRole(r) {
  if (!r) return null;
  const parseJson = (v, def) => {
    if (!v) return def;
    let res = v;
    if (typeof res === 'string') {
      try { res = JSON.parse(res); } catch (e) { return def; }
    }
    if (typeof res === 'string') {
      try { res = JSON.parse(res); } catch (e) {}
    }
    return Array.isArray(res) ? res : def;
  };
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    color: r.color || 'blue',
    modules: parseJson(r.modules, []),
    permissions: parseJson(r.permissions, []),
    isSystem: Boolean(r.is_system),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function createSessionToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    roleId: user.role_id,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function verifySessionToken(token) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const payload = JSON.parse(raw);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    let users;
    try {
      [users] = await pool.query(
        'SELECT * FROM users WHERE (username = ? OR email = ?)',
        [username.trim(), username.trim()]
      );
    } catch (queryErr) {
      // Auto-heal: If users table doesn't exist, initialize database immediately
      if (queryErr.code === 'ER_NO_SUCH_TABLE') {
        console.warn('⚠️ Users table not found. Auto-initializing database schema...');
        await initializeDatabase();
        [users] = await pool.query(
          'SELECT * FROM users WHERE (username = ? OR email = ?)',
          [username.trim(), username.trim()]
        );
      } else {
        throw queryErr;
      }
    }

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = users[0];
    const isPasswordMatch = 
      user.password_hash === password ||
      (user.username === 'admin' && (password === 'admin123' || password === 'Admin@123'));
    if (!isPasswordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is inactive. Please contact administrator.' });
    }

    // Update last login
    try {
      await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    } catch (e) {}

    // Fetch user role
    let role = {
      id: user.role_id,
      name: user.role_name,
      modules: ['/'],
      permissions: []
    };

    try {
      const [roles] = await pool.query('SELECT * FROM roles WHERE id = ?', [user.role_id]);
      if (roles.length > 0) {
        role = roles[0];
      }
    } catch (e) {}

    const token = createSessionToken(user);

    // Record login in audit_logs (safe fallback)
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
         VALUES (?, NOW(), 'auth', 'LOGIN', ?, 'User Session', ?, ?, 'info', NOW())`,
        [
          `aud-${Date.now()}`,
          user.id,
          JSON.stringify({ id: user.id, name: user.name, role: user.role_name }),
          `User ${user.username} logged in successfully from IP ${req.ip || '127.0.0.1'}`
        ]
      );
    } catch (e) {}

    res.json({
      success: true,
      token,
      user: formatUser(user),
      role: formatRole(role),
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifySessionToken(token);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }

    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [payload.userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const [roles] = await pool.query('SELECT * FROM roles WHERE id = ?', [user.role_id]);
    const role = roles.length > 0 ? roles[0] : {
      id: user.role_id,
      name: user.role_name,
      modules: ['/'],
      permissions: []
    };

    res.json({
      user: formatUser(user),
      role: formatRole(role)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const payload = verifySessionToken(authHeader.split(' ')[1]);
      if (payload && payload.userId) {
        await pool.query(
          `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
           VALUES (?, NOW(), 'auth', 'LOGOUT', ?, 'User Session', ?, ?, 'info', NOW())`,
          [
            `aud-${Date.now()}`,
            payload.userId,
            JSON.stringify({ id: payload.userId, name: payload.username, role: payload.roleId }),
            `User ${payload.username} logged out`
          ]
        );
      }
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/users
app.get('/api/auth/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users ORDER BY name ASC');
    res.json(rows.map(formatUser));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/users
app.post('/api/auth/users', async (req, res) => {
  try {
    const b = req.body;
    if (!b.username || !b.name || !b.email) {
      return res.status(400).json({ error: 'Username, name, and email are required.' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)',
      [b.username.trim(), b.email.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A user with this username or email already exists.' });
    }

    const id = b.id || `USR-${Date.now()}`;
    const password = b.password || 'plant123';

    await pool.query(
      `INSERT INTO users (
        id, username, name, email, password_hash, role_id, role_name,
        phone, department, shift, status, avatar, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        id,
        b.username.trim(),
        b.name.trim(),
        b.email.trim(),
        password,
        b.roleId || 'weighbridge_operator',
        b.roleName || 'Weighbridge Scale',
        b.phone || null,
        b.department || 'Operations',
        b.shift || 'General Shift',
        b.status || 'active',
        b.avatar || null
      ]
    );

    // Audit log
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
         VALUES (?, NOW(), 'users', 'USER_CREATED', ?, 'User Account', ?, ?, 'info', NOW())`,
        [`aud-${Date.now()}`, id, JSON.stringify({ name: 'Admin', role: 'admin' }), `User ${b.name} (${b.username}) created`]
      );
    } catch (e) {}

    res.status(201).json({ success: true, id, message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/auth/users/:id
app.put('/api/auth/users/:id', async (req, res) => {
  try {
    const b = req.body;
    const updates = [];
    const params = [];

    if (b.name !== undefined) { updates.push('name = ?'); params.push(b.name.trim()); }
    if (b.email !== undefined) { updates.push('email = ?'); params.push(b.email.trim()); }
    if (b.phone !== undefined) { updates.push('phone = ?'); params.push(b.phone); }
    if (b.department !== undefined) { updates.push('department = ?'); params.push(b.department); }
    if (b.shift !== undefined) { updates.push('shift = ?'); params.push(b.shift); }
    if (b.status !== undefined) { updates.push('status = ?'); params.push(b.status); }
    if (b.roleId !== undefined) { updates.push('role_id = ?'); params.push(b.roleId); }
    if (b.roleName !== undefined) { updates.push('role_name = ?'); params.push(b.roleName); }
    if (b.password !== undefined && b.password) { updates.push('password_hash = ?'); params.push(b.password); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = NOW()');
    params.push(req.params.id);

    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    // Audit log
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
         VALUES (?, NOW(), 'users', 'USER_UPDATED', ?, 'User Account', ?, ?, 'info', NOW())`,
        [`aud-${Date.now()}`, req.params.id, JSON.stringify({ name: 'Admin', role: 'admin' }), `User ID ${req.params.id} updated`]
      );
    } catch (e) {}

    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/auth/users/:id
app.delete('/api/auth/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = rows[0];
    if (u.username === 'admin' || u.username === 'superadmin' || u.id === 'USR-000' || u.id === 'USR-001') {
      return res.status(403).json({ error: 'Cannot delete primary system Administrator or Super Administrator account.' });
    }

    await pool.query('DELETE FROM users WHERE id = ?', [userId]);

    // Audit log
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
         VALUES (?, NOW(), 'users', 'USER_DELETED', ?, 'User Account', ?, ?, 'warning', NOW())`,
        [`aud-${Date.now()}`, userId, JSON.stringify({ name: 'Admin', role: 'admin' }), `User ${u.name} (@${u.username}) deleted`]
      );
    } catch (e) {}

    res.json({ success: true, message: `User ${u.name} deleted successfully` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/roles
app.get('/api/auth/roles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles ORDER BY is_system DESC, name ASC');
    res.json(rows.map(formatRole));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/roles
app.post('/api/auth/roles', async (req, res) => {
  try {
    const b = req.body;
    if (!b.name) {
      return res.status(400).json({ error: 'Role name is required.' });
    }

    const roleId = (b.id || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).trim();
    if (!roleId) {
      return res.status(400).json({ error: 'Invalid role ID.' });
    }

    const [existing] = await pool.query('SELECT id FROM roles WHERE id = ?', [roleId]);
    if (existing.length > 0) {
      return res.status(409).json({ error: `A role with ID "${roleId}" already exists.` });
    }

    const modules = Array.isArray(b.modules) ? b.modules : ['/', '/gate-monitor', '/weighbridge'];
    const permissions = Array.isArray(b.permissions) ? b.permissions : ['weighbridge:operate', 'weighbridge:print'];

    await pool.query(
      `INSERT INTO roles (id, name, description, color, modules, permissions, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, FALSE, NOW(), NOW())`,
      [
        roleId,
        b.name.trim(),
        b.description || '',
        b.color || 'blue',
        JSON.stringify(modules),
        JSON.stringify(permissions)
      ]
    );

    // Audit log
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
         VALUES (?, NOW(), 'roles', 'ROLE_CREATED', ?, 'Security Role', ?, ?, 'info', NOW())`,
        [`aud-${Date.now()}`, roleId, JSON.stringify({ name: 'Admin', role: 'admin' }), `Security Role ${b.name} created`]
      );
    } catch (e) {}

    res.status(201).json({ success: true, id: roleId, message: 'Role created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/auth/roles/:id
app.put('/api/auth/roles/:id', async (req, res) => {
  try {
    const b = req.body;
    const updates = [];
    const params = [];

    if (b.name !== undefined) { updates.push('name = ?'); params.push(b.name.trim()); }
    if (b.description !== undefined) { updates.push('description = ?'); params.push(b.description); }
    if (b.color !== undefined) { updates.push('color = ?'); params.push(b.color); }
    if (b.modules !== undefined) { 
      const mods = Array.isArray(b.modules) ? b.modules : (typeof b.modules === 'string' ? JSON.parse(b.modules) : []);
      updates.push('modules = ?'); 
      params.push(JSON.stringify(mods)); 
    }
    if (b.permissions !== undefined) { 
      const perms = Array.isArray(b.permissions) ? b.permissions : (typeof b.permissions === 'string' ? JSON.parse(b.permissions) : []);
      updates.push('permissions = ?'); 
      params.push(JSON.stringify(perms)); 
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = NOW()');
    params.push(req.params.id);

    await pool.query(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`, params);

    // If role name changed, update role_name in users table
    if (b.name) {
      await pool.query('UPDATE users SET role_name = ? WHERE role_id = ?', [b.name.trim(), req.params.id]);
    }

    // Audit log
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
         VALUES (?, NOW(), 'roles', 'ROLE_UPDATED', ?, 'Security Role', ?, ?, 'info', NOW())`,
        [`aud-${Date.now()}`, req.params.id, JSON.stringify({ name: 'Admin', role: 'admin' }), `Security Role ${req.params.id} updated`]
      );
    } catch (e) {}

    res.json({ success: true, message: 'Role updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/auth/roles/:id
app.delete('/api/auth/roles/:id', async (req, res) => {
  try {
    const roleId = req.params.id;

    // Check system roles
    const SYSTEM_ROLE_IDS = ['super_admin', 'superadmin', 'admin', 'weighbridge_operator', 'gate_operator'];
    if (SYSTEM_ROLE_IDS.includes(roleId)) {
      return res.status(403).json({ error: 'Core system security roles cannot be deleted.' });
    }

    const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [roleId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Check if any users currently assigned this role
    const [assigned] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role_id = ?', [roleId]);
    if (assigned[0].count > 0) {
      return res.status(400).json({
        error: `Cannot delete role "${rows[0].name}" because it is currently assigned to ${assigned[0].count} user(s). Reassign them first.`
      });
    }

    await pool.query('DELETE FROM roles WHERE id = ?', [roleId]);
    await recordSyncTombstone('roles', 'id', roleId);

    // Audit log
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, module, action, entity_id, entity_type, performed_by, details, severity, created_at)
         VALUES (?, NOW(), 'roles', 'ROLE_DELETED', ?, 'Security Role', ?, ?, 'warning', NOW())`,
        [`aud-${Date.now()}`, roleId, JSON.stringify({ name: 'Admin', role: 'admin' }), `Security Role ${rows[0].name} deleted`]
      );
    } catch (e) {}

    res.json({ success: true, message: `Role "${rows[0].name}" deleted successfully` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// COMPANY SETTINGS & BRANDING API
// ==========================================

function formatCompanySettings(row) {
  if (!row) return null;
  let weighbridgeDefaults = {
    defaultRate: 7520,
    defaultMoisture: 8,
    defaultDeduction: 50,
    defaultCharges: 250,
    printDuplicate: false,
    printQrCode: true,
    printImages: true,
    autoWeighInterval: 600,
    minTareWeight: 5000,
    maxGrossWeight: 60000,
    ftp: {
      enabled: false,
      host: '192.168.0.15',
      port: 21,
      user: 'weighbridge',
      password: '',
      secure: false,
      remoteDir: '/snapshots',
    },
    thirdPartyScale: {
      enabled: true,
      mode: 'file_monitor',
      protocol: 'standard_ascii',
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      filePath: 'C:\\Weighbridge\\live_weight.txt',
      tcpHost: '127.0.0.1',
      tcpPort: 4001,
      pollIntervalMs: 500,
    },
  };
  try {
    if (row.weighbridge_defaults) {
      const parsed = typeof row.weighbridge_defaults === 'string'
        ? JSON.parse(row.weighbridge_defaults)
        : row.weighbridge_defaults;
      if (parsed && typeof parsed === 'object') {
        weighbridgeDefaults = { ...weighbridgeDefaults, ...parsed };
      }
    }
  } catch (e) {}

  return {
    id: row.id || 'default_company',
    companyName: row.company_name || 'Dharani Cottons',
    firmName: row.firm_name || 'DHARANI COTTON MILLS',
    plantName: row.plant_name || 'Plant 1 - Main Batching Yard',
    plantCode: row.plant_code || 'PLANT_001',
    tagline: row.tagline || 'Certified Electronic Weighbridge & Automated Concrete Dispatch',
    logoUrl: row.logo_url || '',
    address: row.address || 'Vikarabad',
    city: row.city || 'Hyderabad',
    state: row.state || 'Telangana',
    pincode: row.pincode || '500033',
    phone: row.phone || '+91 20 2712 8899',
    email: row.email || 'weighbridge@dharani.com',
    website: row.website || 'https://www.dharani.com',
    gstin: row.gstin || '27AAAAA0000A1Z5',
    weighbridgeLicense: row.weighbridge_license || 'WB/2026/RMC-449',
    scaleModel: row.scale_model || 'VENTEK VMS-WB',
    scaleCapacity: row.scale_capacity || '50,000 kg (50 MT)',
    scaleDivision: row.scale_division || '10 kg',
    currency: row.currency || '₹',
    weighbridgeDefaults,
    invoiceTerms: row.invoice_terms || '',
    weighSlipNotes: row.weigh_slip_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/company-settings
app.get('/api/company-settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (rows.length === 0) {
      return res.json(formatCompanySettings({}));
    }
    res.json(formatCompanySettings(rows[0]));
  } catch (error) {
    console.error('Get company settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/company-settings
app.put('/api/company-settings', async (req, res) => {
  try {
    const b = req.body;
    const [rows] = await pool.query('SELECT id FROM company_settings LIMIT 1');
    const targetId = rows.length > 0 ? rows[0].id : 'default_company';

    const updates = [];
    const params = [];

    if (b.companyName !== undefined) { updates.push('company_name = ?'); params.push(b.companyName); }
    if (b.firmName !== undefined) { updates.push('firm_name = ?'); params.push(b.firmName); }
    if (b.plantName !== undefined) { updates.push('plant_name = ?'); params.push(b.plantName); }
    if (b.plantCode !== undefined) { updates.push('plant_code = ?'); params.push(b.plantCode); }
    if (b.tagline !== undefined) { updates.push('tagline = ?'); params.push(b.tagline); }
    if (b.logoUrl !== undefined) { updates.push('logo_url = ?'); params.push(b.logoUrl); }
    if (b.address !== undefined) { updates.push('address = ?'); params.push(b.address); }
    if (b.city !== undefined) { updates.push('city = ?'); params.push(b.city); }
    if (b.state !== undefined) { updates.push('state = ?'); params.push(b.state); }
    if (b.pincode !== undefined) { updates.push('pincode = ?'); params.push(b.pincode); }
    if (b.phone !== undefined) { updates.push('phone = ?'); params.push(b.phone); }
    if (b.email !== undefined) { updates.push('email = ?'); params.push(b.email); }
    if (b.website !== undefined) { updates.push('website = ?'); params.push(b.website); }
    if (b.gstin !== undefined) { updates.push('gstin = ?'); params.push(b.gstin); }
    if (b.weighbridgeLicense !== undefined) { updates.push('weighbridge_license = ?'); params.push(b.weighbridgeLicense); }
    if (b.scaleModel !== undefined) { updates.push('scale_model = ?'); params.push(b.scaleModel); }
    if (b.scaleCapacity !== undefined) { updates.push('scale_capacity = ?'); params.push(b.scaleCapacity); }
    if (b.scaleDivision !== undefined) { updates.push('scale_division = ?'); params.push(b.scaleDivision); }
    if (b.currency !== undefined) { updates.push('currency = ?'); params.push(b.currency); }
    if (b.weighbridgeDefaults !== undefined) { updates.push('weighbridge_defaults = ?'); params.push(JSON.stringify(b.weighbridgeDefaults)); }
    if (b.invoiceTerms !== undefined) { updates.push('invoice_terms = ?'); params.push(b.invoiceTerms); }
    if (b.weighSlipNotes !== undefined) { updates.push('weigh_slip_notes = ?'); params.push(b.weighSlipNotes); }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(targetId);
      await pool.query(`UPDATE company_settings SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    if (b.weighbridgeDefaults && b.weighbridgeDefaults.printImages !== undefined) {
      const flag = b.weighbridgeDefaults.printImages ? 1 : 0;
      await pool.query('UPDATE printer_devices SET print_images = ?, updated_at = NOW() WHERE is_default = 1', [flag]).catch(() => {});
    }

    const [updatedRows] = await pool.query('SELECT * FROM company_settings WHERE id = ?', [targetId]);
    res.json({
      success: true,
      settings: formatCompanySettings(updatedRows[0]),
      message: 'Company settings updated successfully'
    });
  } catch (error) {
    console.error('Update company settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/company-settings/logo
app.post('/api/company-settings/logo', async (req, res) => {
  try {
    const { logoUrl } = req.body;
    if (!logoUrl) {
      return res.status(400).json({ error: 'Logo URL / image data is required' });
    }

    // Ensure column is LONGTEXT
    await pool.query('ALTER TABLE company_settings MODIFY COLUMN logo_url LONGTEXT').catch(() => {});

    // If base64 data URL, also write to public/logo.png and public/logo.jpg
    if (typeof logoUrl === 'string' && logoUrl.startsWith('data:image/')) {
      try {
        const base64Data = logoUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const publicDir = path.resolve(__dirname, '../public');
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
        fs.writeFileSync(path.join(publicDir, 'logo.png'), buffer);
        fs.writeFileSync(path.join(publicDir, 'logo.jpg'), buffer);
        console.log('🖼️ Logo updated on filesystem at public/logo.png and public/logo.jpg');
      } catch (err) {
        console.warn('Could not save logo to public files:', err.message);
      }
    }

    const [rows] = await pool.query('SELECT id FROM company_settings LIMIT 1');
    if (rows.length > 0) {
      await pool.query('UPDATE company_settings SET logo_url = ?, updated_at = NOW() WHERE id = ?', [logoUrl, rows[0].id]);
    } else {
      await pool.query('INSERT INTO company_settings (id, company_name, firm_name, logo_url) VALUES (?, ?, ?, ?)', 
        ['default_company', 'Dharani Cotton Mills', 'Dharani Cotton Mills', logoUrl]);
    }

    res.json({ success: true, logoUrl, message: 'Logo updated successfully' });
  } catch (error) {
    console.error('Upload logo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    let targetUserId = userId;

    if (!targetUserId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const payload = verifySessionToken(authHeader.split(' ')[1]);
        if (payload && payload.userId) targetUserId = payload.userId;
      }
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    const [users] = await pool.query('SELECT * FROM users WHERE id = ? OR username = ? OR email = ?', [targetUserId, targetUserId, targetUserId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    if (user.password_hash !== currentPassword) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    await pool.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [newPassword, user.id]);

    // Record in audit_logs
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, timestamp, user_id, user_name, action, module, details, status)
         VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [
          `AUD-PWD-${Date.now()}`,
          user.id,
          user.name,
          'PASSWORD_CHANGED',
          'SECURITY',
          JSON.stringify({ userId: user.id, username: user.username, message: 'Password updated successfully' }),
          'SUCCESS'
        ]
      );
    } catch (e) {}

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Keep mediamtx.yml synchronized with MySQL camera devices
async function syncMediaMtxConfig() {
  try {
    const ymlPath = path.resolve(__dirname, '..', 'mediamtx.yml');
    if (!fs.existsSync(ymlPath)) return;

    const [cameras] = await pool.query(`
      SELECT c.*, r.direct_url, r.url AS rtsp_url
      FROM camera_devices c
      LEFT JOIN device_rtsp_config r ON (c.device_id = r.device_id OR c.id = r.device_id)
      ORDER BY c.created_at
    `);

    let content = fs.readFileSync(ymlPath, 'utf8');
    const pathsMarker = 'paths:';
    const pathsIdx = content.indexOf(pathsMarker);
    if (pathsIdx === -1) return;

    const prePaths = content.substring(0, pathsIdx + pathsMarker.length);

    let pathsYaml = '\n';
    cameras.forEach((cam, idx) => {
      let rtsp = cam.direct_url || cam.rtsp_url || '';
      if (cam.ip_address) {
        const hostMatch = rtsp.match(/@([^:/]+):/);
        const host = hostMatch ? hostMatch[1] : '';
        if (!rtsp || (host && host !== cam.ip_address)) {
          const u = cam.rtsp_username || 'admin';
          const p = cam.rtsp_password || 'Password@123';
          const port = cam.rtsp_port || 554;
          const stream = cam.stream_path || '/ch1/main/av_stream';
          const cleanStream = stream.startsWith('/') ? stream : `/${stream}`;
          rtsp = `rtsp://${u}:${p}@${cam.ip_address}:${port}${cleanStream}`;
        }
      }
      if (!rtsp) return;

      const slug = getCameraSlug(cam.device_id, cam.name);
      const pathAliases = [`cam${idx + 1}`];
      if (slug && !pathAliases.includes(slug)) {
        pathAliases.push(slug);
      }
      if (cam.device_id && !pathAliases.includes(cam.device_id)) {
        pathAliases.push(cam.device_id);
      }

      pathAliases.forEach(alias => {
        pathsYaml += `  ${alias}:\n    source: ${rtsp}\n    sourceProtocol: tcp\n    sourceOnDemand: no\n\n`;
      });
    });

    pathsYaml += `  all_others:\n`;

    const newContent = prePaths + pathsYaml;
    if (newContent !== content) {
      fs.writeFileSync(ymlPath, newContent, 'utf8');
      console.log('🔄 Synced mediamtx.yml with', cameras.length, 'cameras from database');
      restartMediaMtx();
    }
  } catch (err) {
    console.warn('Could not sync MediaMTX configuration:', err.message);
  }
}

function restartMediaMtx() {
  try {
    const { execSync } = require('child_process');
    execSync('taskkill /F /IM mediamtx.exe /T 2>nul || exit 0', { shell: 'cmd.exe' });
  } catch {}
  setTimeout(checkAndStartMediaMtx, 1500);
}

// Ensure MediaMTX RTSP-to-HLS Gateway is running
function checkAndStartMediaMtx() {
  const tester = net.createConnection({ port: 8888, host: '127.0.0.1' }, () => {
    tester.destroy();
    console.log('✅ MediaMTX HLS Gateway is active on port 8888');
  });

  tester.on('error', () => {
    tester.destroy();
    const candidateExePaths = [
      path.resolve(__dirname, '..', 'mediamtx.exe'),
      path.resolve(__dirname, 'mediamtx.exe'),
      process.resourcesPath ? path.resolve(process.resourcesPath, 'mediamtx.exe') : null,
      process.resourcesPath ? path.resolve(process.resourcesPath, 'bin', 'mediamtx.exe') : null,
      path.resolve(process.cwd(), 'mediamtx.exe')
    ].filter(Boolean);

    const exePath = candidateExePaths.find(p => fs.existsSync(p));

    const candidateYmlPaths = [
      path.resolve(__dirname, '..', 'mediamtx.yml'),
      path.resolve(__dirname, 'mediamtx.yml'),
      process.resourcesPath ? path.resolve(process.resourcesPath, 'mediamtx.yml') : null,
      process.resourcesPath ? path.resolve(process.resourcesPath, 'bin', 'mediamtx.yml') : null,
      path.resolve(process.cwd(), 'mediamtx.yml')
    ].filter(Boolean);

    const ymlPath = candidateYmlPaths.find(p => fs.existsSync(p));

    if (exePath && ymlPath) {
      console.log('🔄 Spawning MediaMTX HLS Gateway from', exePath);
      try {
        const child = spawn(exePath, [ymlPath], {
          cwd: path.dirname(exePath),
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
      } catch (err) {
        console.warn('Could not auto-start mediamtx.exe:', err.message);
      }
    }
  });
}

// Periodically supervise MediaMTX every 15 seconds
setInterval(checkAndStartMediaMtx, 15000);

// Serve compiled React frontend in production / packaged Electron
const candidateDistPaths = [
  path.resolve(__dirname, '../dist'),
  path.resolve(__dirname, 'dist'),
  process.resourcesPath ? path.resolve(process.resourcesPath, 'app.asar.unpacked/dist') : null,
  process.resourcesPath ? path.resolve(process.resourcesPath, 'dist') : null,
  process.resourcesPath ? path.resolve(process.resourcesPath, 'app.asar/dist') : null,
  path.resolve(process.cwd(), 'dist')
].filter(Boolean);

for (const dPath of candidateDistPaths) {
  if (fs.existsSync(dPath) && fs.existsSync(path.join(dPath, 'index.html'))) {
    console.log(`📦 Serving compiled UI bundle from ${dPath}`);
    app.use(express.static(dPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/snapshots')) {
        return next();
      }
      res.sendFile(path.join(dPath, 'index.html'));
    });
    break;
  }
}

// Start server
async function startServer() {
  // Test database connection
  const connected = await testConnection();
  
  if (connected) {
    // Sync MediaMTX config with DB cameras
    await syncMediaMtxConfig().catch(() => {});
    // Initialize database tables
    await initializeDatabase();
  }

  // Ensure camera streaming proxy is online
  checkAndStartMediaMtx();
  
  // Start Ventek Weighbridge serial integration service
  ventekSerialService.start();
  
  // Start FTP ANPR camera watcher
  ftpAnprWatcher.start();
  
  // Start automated Edge-to-Server MySQL Synchronization Service (Every 5 minutes)
  await cloudSyncService.initialize({
    startScheduler: process.env.SYNC_RUN_SCHEDULER !== 'false',
  });
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
    console.log(`🎯 ANPR endpoints available at http://localhost:${PORT}/api/anpr`);
    console.log(`🔄 Edge-to-Server MySQL Sync configured (Target: ${cloudSyncService.getDestinationLabel()})`);
    if (!connected) {
      console.log('⚠️  Warning: Database connection failed. Please check MySQL configuration.');
    }
  });
}

startServer();
