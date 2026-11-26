# Docker & Docker Compose Setup Guide

## Architecture Overview

`docker-compose.yml` orchestrates five services over an isolated internal bridge network (`rmc-network`):

1. **`frontend`** — Multi-stage Vite + Nginx reverse proxy serving the React UI and proxying `/api/*` and `/snapshots/*` to `backend`.
2. **`backend`** — Node.js 20 Express API (`PORT=3001`) with MySQL connection pooling and healthcheck (`/api/health?strict=true`). Runs with `SYNC_RUN_SCHEDULER=false` because scheduling is delegated to `sync-worker`.
3. **`database`** — MySQL 8.0 with persistent volume `rmc_mysql_data` (`expose: 3306` internal only — never exposed publicly).
4. **`phpmyadmin`** — Web database administration bound to `127.0.0.1:8081` by default for security, configurable via `PMA_HOST` to inspect either the containerized production database (`database`) or host/local MySQL (`host.docker.internal`).
5. **`sync-worker`** — Dedicated silent background synchronization container (`node sync-worker.js`) running incremental local-to-server MySQL sync every 5 minutes.

## Prerequisites

- Docker Engine 24+ and Docker Compose v2 (`docker compose version`)

## Quick Start (Windows & Linux)

1. Prepare environment file (never commit `.env` or `.env.production`):
   ```bash
   cp .env.example .env
   ```
   Set strong passwords for `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `CLOUD_SYNC_SECRET`.

2. Validate Compose configuration:
   ```bash
   docker compose config
   ```

3. Build and start all 5 services:
   ```bash
   docker compose up -d --build
   ```

4. Verify container health and logs:
   ```bash
   docker compose ps
   docker compose logs -f backend sync-worker
   ```

## phpMyAdmin Access & Security

- Default URL (SSH-tunneled or local host): `http://localhost:8081`
- Server MySQL host inside Compose: `PMA_HOST=database` (`PMA_ARBITRARY=0`)
- To administer a local host MySQL instance from Docker phpMyAdmin, set in `.env`:
  ```env
  PMA_HOST=host.docker.internal
  PMA_PORT_NUM=3306
  ```
- In production over the internet, keep `PMA_BIND_IP=127.0.0.1` and access via SSH tunnel:
  ```bash
  ssh -L 8081:127.0.0.1:8081 user@your-server-ip
  ```
  Or deploy behind Traefik HTTPS + BasicAuth using `docker-compose.coolify.yml`:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.coolify.yml up -d
  ```

## Safe Stop & Persistence Rules

- Stop containers while preserving database data:
  ```bash
  docker compose stop
  ```
- **NEVER** run `docker compose down -v` in production, as `-v` deletes the `rmc_mysql_data` volume.
