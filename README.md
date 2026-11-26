# Dharani Weighbridge & Gate Management System

Full-stack weighbridge operations, ANPR gate surveillance, slip printing, reporting, and automated local-to-server MySQL synchronization platform.

## Technology Stack

- **Frontend:** React 18, TypeScript, Vite 5, Tailwind CSS, shadcn/ui, React Query (`src/`)
- **Backend:** Node.js 20+ (ESM), Express, `mysql2/promise`, `basic-ftp`, `serialport` (`server/`)
- **Database:** MySQL 8.0 (`dharani_weighbridge`)
- **Containerization:** Docker + Docker Compose (`frontend`, `backend`, `database`, `phpmyadmin`, `sync-worker`)
- **CI/CD:** Jenkins (`Jenkinsfile`)

## Local Development Setup (Windows & Linux)

### 1. Prerequisites

- Node.js 20+ (`node -v`)
- MySQL Server 8.0 running on `localhost:3306`

### 2. Configure Environment Files

Environment files are separated by target environment:
- `.env.example` / `server/.env.example` — committed templates (placeholders only)
- `.env.development` — local development defaults
- `.env.production` — production server template (ignored by Git)
- `server/.env` — active local backend configuration (ignored by Git)

Verify `server/.env` contains your local MySQL credentials:

```env
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=dharani_weighbridge
```

### 3. Install Dependencies

#### Windows (PowerShell)
```powershell
npm install
npm --prefix server install
```

#### Linux / macOS
```bash
npm install
npm --prefix server install
```

### 4. Initialize Database & Run Locally

Start the backend (automatically creates missing tables without dropping existing data, and starts the silent 5-minute background sync loop):

```powershell
# Terminal 1 - Backend API (http://localhost:3001)
npm --prefix server start
```

```powershell
# Terminal 2 - Frontend Vite Dev Server (http://localhost:8080)
npm run dev
```

Verify health and database connectivity:
```powershell
curl http://localhost:3001/api/health?strict=true
curl http://localhost:3001/api/sync/status
```

### 5. Run Unit Tests & Production Build

```powershell
npm test
npx tsc --noEmit
npm run build
```

## Additional Guides

- [DOCKER_SETUP.md](./DOCKER_SETUP.md) — Docker Compose services, volumes, and phpMyAdmin
- [DATABASE_SYNC.md](./DATABASE_SYNC.md) — Silent 5-minute incremental MySQL sync & monitoring
- [JENKINS_SETUP.md](./JENKINS_SETUP.md) — Jenkins CI/CD pipeline & credentials setup
- [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) — Production server MySQL & rollout guide
