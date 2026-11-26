const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

let mainWindow = null;
const SERVER_PORT = process.env.PORT || 3001;
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Helper to check if server port is responding
function isServerReady(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/auth/users`, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(600, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Start backend server directly in-process
async function ensureServerRunning() {
  const running = await isServerReady(SERVER_PORT);
  if (running) {
    console.log(`Backend server already responding on port ${SERVER_PORT}`);
    return;
  }

  console.log('Initializing backend server within Electron main process...');
  try {
    let serverEntry;
    if (app.isPackaged) {
      serverEntry = path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.js');
    } else {
      serverEntry = path.resolve(__dirname, '../server/index.js');
    }
    console.log(`Server entry resolved to: ${serverEntry}`);
    await import(pathToFileURL(serverEntry).href);
    console.log('Backend server initialized successfully!');
  } catch (err) {
    console.error('Error starting in-process backend server:', err);
    dialog.showErrorBox(
      'Server Startup Warning',
      `The local backend server could not be started:\n\n${err.message || err}\n\nThe app will attempt to connect to http://localhost:${SERVER_PORT}.`
    );
  }
}

async function createWindow() {
  const iconPath = path.resolve(__dirname, '../public/favicon.ico');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'Dharani Weighbridge & Security Management System',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    backgroundColor: '#0f172a',
    show: true, // Display window immediately
  });

  const targetUrl = `http://localhost:${SERVER_PORT}`;
  console.log(`Loading application from: ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  // Capture and forward renderer errors & console messages
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [Level ${level}]: ${message} (${sourceId}:${line})`);
  });

  // If initial load fails because server is still spinning up, retry automatically
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`Initial page load waiting for backend (${errorCode}: ${errorDescription}), retrying in 800ms...`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(targetUrl);
      }
    }, 800);
  });

  // If in development mode and devtools requested
  if (isDev && process.env.OPEN_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Desktop controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false);
ipcMain.handle('app-version', () => app.getVersion());

app.whenReady().then(async () => {
  await ensureServerRunning();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
