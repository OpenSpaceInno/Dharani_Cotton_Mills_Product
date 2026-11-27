import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(serverRoot, '..');

let loaded = false;

/**
 * Loads environment variables in precedence order without overriding variables
 * already provided by the host shell, Docker Compose, or CI/CD runner.
 *
 * Precedence (highest to lowest among files):
 * 1. Existing process.env
 * 2. server/.env.<NODE_ENV>.local / .env.<NODE_ENV>.local
 * 3. server/.env.<NODE_ENV> / .env.<NODE_ENV>
 * 4. server/.env / .env
 */
export function loadEnvironment() {
  if (loaded) return;
  loaded = true;

  const nodeEnv = process.env.NODE_ENV || 'development';
  const dataDir = process.env.DHARANI_DATA_DIR || '';
  const candidates = [
    dataDir ? path.join(dataDir, 'server.env') : null,
    path.join(serverRoot, `.env.${nodeEnv}.local`),
    path.join(projectRoot, `.env.${nodeEnv}.local`),
    path.join(serverRoot, `.env.${nodeEnv}`),
    path.join(projectRoot, `.env.${nodeEnv}`),
    path.join(serverRoot, '.env'),
    path.join(projectRoot, '.env'),
  ].filter(Boolean);

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false });
    }
  }
}

loadEnvironment();
