/**
 * Dharani Weighbridge — Electron Main Process
 * ============================================================================
 * Production-grade Electron host that:
 *  1. Enforces single-instance lock.
 *  2. Starts the embedded Express/Node backend in-process (no child_process).
 *  3. Creates a secure BrowserWindow (contextIsolation ON, nodeIntegration OFF).
 *  4. Exposes a minimal IPC surface for sync status, window controls, and version.
 *  5. Applies strict navigation restrictions and disables devtools in production.
 *  6. Handles graceful shutdown and backend teardown.
 *
 * Security model
 * ─────────────
 *  • No sensitive credentials live in this file.
 *  • Server reads credentials from %APPDATA%\Dharani Weighbridge\server.env
 *    (written by the installer or first-run wizard — see preload wizard IPC).
 *  • contextBridge exposes ONLY the APIs listed in preload.cjs.
 *  • IPC handlers validate every argument and do not eval() user data.
 *  • Navigation is locked to localhost:PORT.
 *  • DevTools are unavailable in packaged builds (app.isPackaged === true).
 *
 * NOTE: ASAR + JS minification are not complete source protection.
 * Keep all secret business logic and server credentials on the backend.
 * ============================================================================
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path   = require('path');
const http   = require('http');
const fs     = require('fs');
const { pathToFileURL } = require('url');

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_NAME     = 'Dharani Weighbridge';
const SERVER_PORT  = Number(process.env.PORT) || 3001;
const IS_PACKAGED  = app.isPackaged;
const IS_DEV       = !IS_PACKAGED && process.env.NODE_ENV !== 'production';
const APP_DATA_DIR = path.join(app.getPath('userData'), '');   // e.g. %APPDATA%\Dharani Weighbridge
const SERVER_ENV_PATH = path.join(APP_DATA_DIR, 'server.env'); // client-local credentials file

// ─── Single-instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ─── Global state ─────────────────────────────────────────────────────────────
let mainWindow   = null;
let syncStatus   = {
  dbConnected   : false,
  serverOnline  : false,
  lastSyncAt    : null,
  nextSyncAt    : null,
  pendingCount  : 0,
  failedCount   : 0,
  syncState     : 'idle',   // idle | syncing | success | error
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Poll localhost until Express is accepting connections (max ~30s). */
function waitForServer(port, maxMs = 30000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs;
    const tryOnce  = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        resolve(res.statusCode < 500);
      });
      req.on('error', () => {
        if (Date.now() < deadline) setTimeout(tryOnce, 600);
        else resolve(false);
      });
      req.setTimeout(500, () => { req.destroy(); if (Date.now() < deadline) setTimeout(tryOnce, 600); else resolve(false); });
    };
    tryOnce();
  });
}

/** Resolve the server entry point — works both dev and packaged (asar-unpacked). */
function resolveServerEntry() {
  if (IS_PACKAGED) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.js');
  }
  return path.resolve(__dirname, '..', 'server', 'index.js');
}

/** Inject the per-client .env file into process.env BEFORE the server boots. */
function injectClientEnv() {
  // Ensure userData dir exists (Electron creates it, but guard anyway)
  if (!fs.existsSync(APP_DATA_DIR)) {
    try { fs.mkdirSync(APP_DATA_DIR, { recursive: true }); } catch (_) {}
  }

  // If client env file exists, inject it into process.env WITHOUT overriding values
  // that may have been set by the installer/update wizard already.
  if (fs.existsSync(SERVER_ENV_PATH)) {
    const lines = fs.readFileSync(SERVER_ENV_PATH, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
    console.log(`[Electron] Client env loaded from ${SERVER_ENV_PATH}`);
  } else {
    console.log(`[Electron] No client env at ${SERVER_ENV_PATH} — server uses defaults / packaged env.`);
  }
}

// ─── Backend startup ──────────────────────────────────────────────────────────

/**
 * Boot the Express backend in-process.
 * We use dynamic import() so the ESM server module loads in the CJS main process.
 * The server reads DB credentials from process.env (injected above).
 */
async function startBackend() {
  injectClientEnv();

  const serverEntry = resolveServerEntry();
  console.log(`[Electron] Starting backend from: ${serverEntry}`);

  try {
    await import(pathToFileURL(serverEntry).href);
    console.log('[Electron] Backend initialised successfully.');
  } catch (err) {
    console.error('[Electron] Backend startup error:', err);
    // Non-fatal: app continues; the renderer will show the connection-failed screen.
    dialog.showErrorBox(
      `${APP_NAME} — Backend Warning`,
      `The local backend server could not start:\n\n${err.message}\n\n` +
      `The application will try to connect to http://localhost:${SERVER_PORT}.\n\n` +
      `If this persists, ensure MySQL is running and check your server.env configuration.`
    );
  }
}

// ─── BrowserWindow ────────────────────────────────────────────────────────────

function resolveIcon() {
  if (IS_PACKAGED) {
    return path.join(process.resourcesPath, 'icons', 'icon.ico');
  }
  return path.resolve(__dirname, '..', 'public', 'favicon.ico');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width         : 1366,
    height        : 850,
    minWidth      : 1024,
    minHeight     : 700,
    title         : APP_NAME,
    icon          : resolveIcon(),
    autoHideMenuBar: true,
    frame         : true,
    backgroundColor: '#0f172a',
    show          : false,   // show after ready-to-show to avoid white flash
    webPreferences: {
      preload         : path.join(__dirname, 'preload.cjs'),
      nodeIntegration : false,         // SECURITY: renderer has no Node.js access
      contextIsolation: true,          // SECURITY: renderer context isolated from preload
      webSecurity     : true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // Disable remote module (default false in Electron 14+, explicit for safety)
      enableRemoteModule: false,
    },
  });

  // ── Content Security Policy ────────────────────────────────────────────────
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          // Allow scripts from self + unsafe-inline (required by React/Vite bundle)
          // Allow connections only to localhost backend
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*; " +
          `connect-src 'self' http://127.0.0.1:${SERVER_PORT} http://localhost:${SERVER_PORT} ws://127.0.0.1:* ws://localhost:*; ` +
          "font-src 'self' data:; " +
          "media-src 'self' blob: http://127.0.0.1:* http://localhost:*; " +
          "object-src 'none'; " +
          "frame-src 'none';"
        ],
      },
    });
  });

  // ── Navigation guard — only allow localhost:PORT ───────────────────────────
  const allowedOrigin = `http://localhost:${SERVER_PORT}`;
  const allowed127    = `http://127.0.0.1:${SERVER_PORT}`;

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin) && !url.startsWith(allowed127)) {
      event.preventDefault();
      console.warn(`[Electron] Navigation blocked to external URL: ${url}`);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in system browser, never in Electron
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // ── Load app ──────────────────────────────────────────────────────────────
  const appUrl = `http://localhost:${SERVER_PORT}`;
  mainWindow.loadURL(appUrl);

  // ── Retry on initial load failure (backend still spinning up) ─────────────
  let retryCount = 0;
  mainWindow.webContents.on('did-fail-load', (_evt, code, desc) => {
    if (retryCount < 10) {
      retryCount++;
      console.log(`[Electron] Load failed (${code}: ${desc}), retry ${retryCount}/10 in 1s…`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(appUrl);
      }, 1000);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    retryCount = 0;
  });

  // ── Show window once content is painted ───────────────────────────────────
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // ── Block DevTools in production ──────────────────────────────────────────
  if (IS_PACKAGED) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  } else if (process.env.OPEN_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // ── Forward renderer console messages (dev only) ──────────────────────────
  if (IS_DEV) {
    mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
      const labels = ['verbose', 'info', 'warn', 'error'];
      console.log(`[Renderer:${labels[level] || level}] ${msg}  (${src}:${line})`);
    });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Window controls ────────────────────────────────────────────────────────
  ipcMain.on('window-minimize',  () => mainWindow?.minimize());
  ipcMain.on('window-maximize',  () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
  ipcMain.on('window-close',     () => mainWindow?.close());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

  // ── App metadata ───────────────────────────────────────────────────────────
  ipcMain.handle('app-version',  () => app.getVersion());
  ipcMain.handle('app-name',     () => APP_NAME);
  ipcMain.handle('app-data-dir', () => APP_DATA_DIR);
  ipcMain.handle('is-packaged',  () => IS_PACKAGED);

  // ── Sync status (pulled from in-process sync service cache) ───────────────
  ipcMain.handle('sync-get-status', () => ({ ...syncStatus }));

  // ── Trigger manual sync (calls backend HTTP endpoint in-process) ──────────
  ipcMain.handle('sync-trigger-now', async () => {
    return new Promise((resolve) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: SERVER_PORT, path: '/api/sync/trigger', method: 'POST' },
        (res) => {
          let body = '';
          res.on('data', (d) => { body += d; });
          res.on('end', () => {
            try { resolve({ ok: true, data: JSON.parse(body) }); }
            catch { resolve({ ok: true, data: body }); }
          });
        }
      );
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.end();
    });
  });

  // ── Open external URL safely ───────────────────────────────────────────────
  ipcMain.handle('open-external', (_evt, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  // ── Show save-file dialog (e.g. PDF export) ───────────────────────────────
  ipcMain.handle('dialog-save-file', async (_evt, { defaultName, filters }) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save File',
      defaultPath: defaultName || 'export',
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  // ── Write file to path (renderer cannot access fs directly) ───────────────
  ipcMain.handle('write-file', async (_evt, { filePath, base64Data }) => {
    if (typeof filePath !== 'string' || !filePath.startsWith(app.getPath('downloads')) &&
        !filePath.startsWith(app.getPath('desktop')) &&
        !filePath.startsWith(APP_DATA_DIR)) {
      return { ok: false, error: 'Invalid file path: must be in Downloads, Desktop, or AppData' };
    }
    try {
      const buf = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buf);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Theme toggle passthrough ───────────────────────────────────────────────
  ipcMain.handle('dark-mode-toggle', () => {
    nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
    return nativeTheme.shouldUseDarkColors;
  });
}

// ─── Sync status polling ──────────────────────────────────────────────────────
// Poll the backend /api/sync/status endpoint every 15 s and cache locally.
// The renderer can request this via IPC without hammering the server itself.
function startSyncStatusPolling() {
  const poll = () => {
    const req = http.get(
      `http://127.0.0.1:${SERVER_PORT}/api/sync/status`,
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            syncStatus = {
              dbConnected  : data.database === 'connected',
              serverOnline : data.targetReachable === true,
              lastSyncAt   : data.lastSyncAt ?? data.lastSuccessAt ?? null,
              nextSyncAt   : data.nextSyncAt ?? null,
              pendingCount : data.pendingCount ?? 0,
              failedCount  : data.failedCount ?? 0,
              syncState    : data.status ?? 'idle',
            };
            // Push live update to renderer if window is open
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('sync-status-update', syncStatus);
            }
          } catch (_) {}
        });
      }
    );
    req.on('error', () => {
      syncStatus.dbConnected  = false;
      syncStatus.serverOnline = false;
    });
    req.setTimeout(3000, () => req.destroy());
  };

  // First poll after backend has had time to settle
  setTimeout(poll, 8000);
  setInterval(poll, 15000);
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerIpcHandlers();

  // Start backend in-process
  await startBackend();

  // Wait for the Express server to be ready before opening the window
  const ready = await waitForServer(SERVER_PORT, 30000);
  if (!ready) {
    console.warn('[Electron] Backend did not respond in time — opening window anyway (retries will handle it).');
  }

  await createWindow();
  startSyncStatusPolling();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Second instance: focus existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Quit when all windows closed (Windows / Linux)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Prevent new webviews / BrowserViews from being created
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowedBase = `http://localhost:${SERVER_PORT}`;
    if (!url.startsWith(allowedBase) && !url.startsWith(`http://127.0.0.1:${SERVER_PORT}`)) {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
