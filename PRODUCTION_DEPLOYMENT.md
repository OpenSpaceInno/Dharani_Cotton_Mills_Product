# Production Deployment Guide

## 1. Environment Separation

Never reuse local `root/root` credentials in production and never commit `.env.production` or `server/.env` to Git.

On the production Linux server:

```bash
mkdir -p /opt/dharani-weighbridge
cd /opt/dharani-weighbridge
cp .env.example .env
chmod 600 .env
```

Configure production values in `/opt/dharani-weighbridge/.env`:
- `NODE_ENV=production`
- `DB_HOST=database` (or your managed MySQL hostname)
- `DB_USER` & strong `DB_PASSWORD` & `MYSQL_ROOT_PASSWORD`
- `DB_POOL_SIZE=20`, `DB_CONNECT_TIMEOUT_MS=10000`
- `CORS_ORIGIN=https://your-domain.com`
- `CLOUD_SYNC_SECRET=<strong-random-32+-char-secret>`
- `CLOUD_SYNC_ENABLED=false` (the central production server receives pushes from plant edge machines rather than syncing outward)

## 2. Production MySQL Hardening

- Inside Docker Compose, MySQL (`database`) is attached only to the private `rmc-network` bridge (`expose: 3306`, no public `ports` binding).
- If using an external/managed MySQL server, restrict port `3306` via firewall (`ufw`) to application/plant IP addresses only and grant least-privilege permissions on `dharani_weighbridge` rather than `root`.

## 3. Deploy with Docker Compose

### Linux Production Server Commands

```bash
# Build and start all services in detached mode
docker compose up -d --build

# Verify service health
docker compose ps
curl -fs http://127.0.0.1:8080/api/health?strict=true

# View logs
docker compose logs -f backend frontend sync-worker
```

### With Coolify / Traefik HTTPS

```bash
docker compose -f docker-compose.yml -f docker-compose.coolify.yml up -d --build
```

## 4. Database Administration (phpMyAdmin)

- Bound by default to `127.0.0.1:8081`.
- Access securely via SSH port forwarding:
  ```bash
  ssh -L 8081:127.0.0.1:8081 deploy@your-server-ip
  ```
  Then open `http://localhost:8081` in your browser and log in with your MySQL credentials.

## 5. Post-Deployment Verification Checklist

- [ ] `GET /api/health?strict=true` returns `{"status":"ok","database":"connected"}`
- [ ] Frontend loads at `https://your-domain.com` (or `http://server-ip:8080`)
- [ ] Existing database records are intact (`weighbridge_sessions`, `weigh_slips`, `anpr_events`)
- [ ] Plant edge `server/.env` points `REMOTE_DB_HOST` / `CLOUD_SERVER_URL` to the production server
- [ ] Edge `GET /api/sync/status` shows `status: healthy` / `idle` with zero failed records
