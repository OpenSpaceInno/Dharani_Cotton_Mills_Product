import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');
const downloadsDir = path.join(projectRoot, 'electron-downloads');

function calculateSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function distribute() {
  console.log('================================================================');
  console.log(' Packaging and Populating electron-downloads/ Distribution');
  console.log('================================================================');

  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  // Look for installer executable in release folder
  if (!fs.existsSync(releaseDir)) {
    console.error(`❌ Release directory not found at: ${releaseDir}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.2';
  const targetExeName = `Dharani-Weighbridge-Setup-${version}-x64.exe`;

  const files = fs.readdirSync(releaseDir);
  const exactMatch = files.find(f => f === targetExeName);
  const installerExe = exactMatch ||
                       files.find(f => f.endsWith('.exe') && f.includes(version)) ||
                       files.find(f => f.endsWith('.exe') && f.includes('Setup')) ||
                       files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('portable'));

  if (!installerExe) {
    console.warn('⚠️ No .exe installer found in release/. Available files:', files);
    console.log('Please run npm run build:installer first.');
    return;
  }

  const sourceExePath = path.join(releaseDir, installerExe);
  const targetExePath = path.join(downloadsDir, targetExeName);

  console.log(`📦 Copying ${installerExe} -> electron-downloads/${targetExeName}...`);
  fs.copyFileSync(sourceExePath, targetExePath);

  const stats = fs.statSync(targetExePath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  const sha256 = calculateSha256(targetExePath);

  console.log(`✅ Installer Size: ${sizeMb} MB`);
  console.log(`✅ SHA-256: ${sha256}`);

  // Create checksums.txt
  const checksumContent = `${sha256} *${targetExeName}\n`;
  fs.writeFileSync(path.join(downloadsDir, 'checksums.txt'), checksumContent, 'utf8');

  // Create release-notes.txt
  const releaseNotes = `================================================================================
Dharani Weighbridge Desktop Application — Release Notes
================================================================================
Version: ${version}
Architecture: Windows x64 (64-bit)
Target OS: Windows 10 / Windows 11 / Windows Server 2016+
Package Type: Production NSIS Installer (${targetExeName})
Installer Size: ~${sizeMb} MB
SHA-256: ${sha256}
Release Date: ${new Date().toISOString().split('T')[0]}

================================================================================
KEY FEATURES & CAPABILITIES
================================================================================
1. Complete Offline-First Weighbridge Operation:
   - Real-time scale integration and gross / tare / net weight capture.
   - Dual-camera ANPR and gate security event monitoring.
   - Industrial slip printing, QR code generation, and PDF generation.

2. Production Security & Zero Source-Code Exposure:
   - Full ASAR packaging with separate main and preload process architecture.
   - contextIsolation: true, nodeIntegration: false, webSecurity: true.
   - No frontend or backend source code, typescript files, git history, 
     or source maps included in the client installation.
   - Sensitive database passwords and remote sync credentials are stored 
     outside the installation directory in %APPDATA%\\Dharani Weighbridge\\server.env.

3. Automatic 5-Minute Database Synchronization:
   - Background sync worker connects local client MySQL to Central Server MySQL.
   - Runs automatically on startup and every 5 minutes in the background.
   - Uninterrupted offline mode: slips and transactions continue locally when 
     internet is down, and sync resumes automatically upon reconnection.
   - Conflict-safe UPSERT and tombstone delete propagation.

4. Client Laptop Prerequisite:
   - MySQL Server 8.0+ running locally (default port 3306).
   - If not installed, install MySQL Community Server 8.0:
     https://dev.mysql.com/downloads/mysql/

================================================================================
INSTALLATION & FIRST-RUN SETUP
================================================================================
1. Double-click '${targetExeName}' and follow the installation wizard.
2. Select your destination directory and create desktop / start menu shortcuts.
3. Open or edit your configuration at:
   %APPDATA%\\Dharani Weighbridge\\server.env
4. Ensure DB_PASSWORD matches your local MySQL root password.
5. Launch 'Dharani Weighbridge' from your Desktop or Start Menu!
================================================================================
`;

  fs.writeFileSync(path.join(downloadsDir, 'release-notes.txt'), releaseNotes, 'utf8');
  console.log('✅ Generated checksums.txt and release-notes.txt in electron-downloads/');
  console.log('🎉 electron-downloads directory is ready for client distribution!');
}

distribute();
