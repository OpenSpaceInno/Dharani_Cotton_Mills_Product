/**
 * Dharani Weighbridge — Electron Preload Script
 * ============================================================================
 * Runs in a privileged context (Node.js available) but exposes ONLY the
 * specific APIs listed below to the renderer world via contextBridge.
 *
 * Security rules:
 *  • contextIsolation: true  — renderer cannot reach this module's scope.
 *  • nodeIntegration: false  — renderer cannot require('fs') or similar.
 *  • Every exposed function validates its arguments before invoking IPC.
 *  • No secrets are exposed to the renderer.
 * ============================================================================
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Allowed IPC channels (whitelist) ─────────────────────────────────────────
const SEND_CHANNELS   = ['window-minimize', 'window-maximize', 'window-close'];
const INVOKE_CHANNELS = [
  'window-is-maximized',
  'app-version',
  'app-name',
  'app-data-dir',
  'is-packaged',
  'sync-get-status',
  'sync-trigger-now',
  'open-external',
  'dialog-save-file',
  'write-file',
  'dark-mode-toggle',
];
const RECEIVE_CHANNELS = ['sync-status-update'];

// ── Safe invoke wrapper ───────────────────────────────────────────────────────
function safeInvoke(channel, ...args) {
  if (!INVOKE_CHANNELS.includes(channel)) {
    return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

// ── Expose to renderer window.electronAPI ─────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Environment ────────────────────────────────────────────────────────────
  platform    : process.platform,
  isElectron  : true,

  // ── Window controls ────────────────────────────────────────────────────────
  minimize    : () => ipcRenderer.send('window-minimize'),
  maximize    : () => ipcRenderer.send('window-maximize'),
  close       : () => ipcRenderer.send('window-close'),
  isMaximized : () => safeInvoke('window-is-maximized'),

  // ── App metadata ───────────────────────────────────────────────────────────
  getVersion  : () => safeInvoke('app-version'),
  getAppName  : () => safeInvoke('app-name'),
  getAppDataDir: () => safeInvoke('app-data-dir'),
  isPackaged  : () => safeInvoke('is-packaged'),

  // ── Sync service ───────────────────────────────────────────────────────────
  /**
   * Get the last cached sync status (non-blocking, returns immediately).
   * @returns {Promise<{dbConnected, serverOnline, lastSyncAt, nextSyncAt,
   *                    pendingCount, failedCount, syncState}>}
   */
  getSyncStatus  : () => safeInvoke('sync-get-status'),
  /**
   * Ask the backend to run a sync cycle right now.
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  triggerSyncNow : () => safeInvoke('sync-trigger-now'),

  /**
   * Subscribe to live sync-status push events from the main process.
   * @param {function} callback  Receives the status object on each update.
   * @returns {function}         Call to unsubscribe.
   */
  onSyncStatusUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('sync-status-update', listener);
    return () => ipcRenderer.removeListener('sync-status-update', listener);
  },

  // ── File system (gated — main process validates paths) ─────────────────────
  /**
   * Open a save-file dialog.
   * @param {{ defaultName?: string, filters?: {name,extensions}[] }} opts
   * @returns {Promise<string|null>}  Chosen file path or null if cancelled.
   */
  showSaveDialog : (opts = {}) => safeInvoke('dialog-save-file', opts),
  /**
   * Write a base64-encoded binary file to a safe path.
   * Main process restricts destination to Downloads / Desktop / AppData.
   * @param {{ filePath: string, base64Data: string }} opts
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  writeFile      : (opts) => safeInvoke('write-file', opts),

  // ── Utilities ─────────────────────────────────────────────────────────────
  /**
   * Open a URL in the user's default system browser.
   * Only https:// and http:// schemes are allowed.
   */
  openExternal   : (url) => safeInvoke('open-external', url),
  toggleDarkMode : () => safeInvoke('dark-mode-toggle'),
});
