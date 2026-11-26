# Dharani Weighbridge — Electron Desktop Application Client Installation & Architecture Guide

## 1. Overview
The Dharani Weighbridge Desktop Application is a packaged, production-grade 64-bit Windows software designed for deployment on client laptops and weighbridge operator workstations.

The distribution package is maintained strictly inside:
```text
electron-downloads/
├── Dharani-Weighbridge-Setup-1.0.0-x64.exe
├── release-notes.txt
└── checksums.txt
```

---

## 2. Source-Code Protection & Security Architecture
In accordance with strict production requirements:
1. **Zero Raw Source Code Exposed**:
   - The React TypeScript frontend is bundled and minified (`vite build` -> `dist/`).
   - No `.ts`, `.tsx`, `.map` (source maps), or development tooling files are packaged.
   - Frontend and backend code are enclosed in an **ASAR archive** (`app.asar`), separating application assets from raw filesystem exploration.
2. **Hardened Electron Security Settings**:
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - `webSecurity: true`
   - Strict Content Security Policy (CSP) blocking external unauthorized scripts or iframes.
   - External links (`shell.openExternal`) are strictly delegated to the OS default browser.
   - DevTools are automatically suppressed and disabled in production.
3. **No Embedded Passwords or Secrets**:
   - Database credentials, remote sync keys, and server addresses are **never hardcoded** in packaged files.
   - Credentials are read at runtime from outside the install directory:
     `%APPDATA%\Dharani Weighbridge\server.env`

---

## 3. Local MySQL Database Architecture
The application runs offline-first against a local MySQL database (`dharani_weighbridge` on port `3306`):
- **Prerequisite**: MySQL Server 8.0 or later must be installed on the client machine.
- **Auto-Initialization**: On startup, `server/db.js` verifies the presence of database tables (`users`, `weigh_slips`, etc.). If empty, it executes `server/init.sql` automatically.
- **Data Preservation**: Upgrading or uninstalling the Electron application **never** touches or deletes the MySQL data directories or client database tables.

---

## 4. Automatic 5-Minute Local-to-Server Sync
- **Engine**: The built-in `CloudSyncService` (`server/cloud-sync-service.js`) handles bidirectional synchronization between the client laptop and the central production database.
- **Frequency**: Every 5 minutes (`CLOUD_SYNC_INTERVAL_MS=300000`), plus an initial run on application boot.
- **Resilience**:
  - If the internet goes down, operators continue weighing trucks, saving slips, and printing without delay or interruption.
  - Changes are queued locally and automatically pushed once network connectivity returns.
  - Conflict-safe upserts prevent accidental overwrites.
  - Audit logging is recorded in the local `sync_logs` table.

---

## 5. Client Installation Instructions
1. Download `Dharani-Weighbridge-Setup-1.0.0-x64.exe` from `electron-downloads/`.
2. Verify integrity (optional) using `checksums.txt`:
   ```powershell
   Get-FileHash -Algorithm SHA256 .\Dharani-Weighbridge-Setup-1.0.0-x64.exe
   ```
3. Run the installer:
   - Select installation directory.
   - Allow shortcuts creation on Desktop and Start Menu.
4. If MySQL is already installed, ensure the root password is set in:
   `%APPDATA%\Dharani Weighbridge\server.env`
5. Launch **Dharani Weighbridge** from your Desktop shortcut!
