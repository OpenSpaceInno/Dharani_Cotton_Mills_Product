# Jenkins CI/CD Pipeline Setup Guide

## Pipeline Overview

The root `Jenkinsfile` automates:
1. Git checkout & commit-tagged build versioning (`<BUILD_NUMBER>-<GIT_SHA>`)
2. Frontend and backend dependency installation (`npm ci`)
3. Backend JavaScript syntax validation (`node --check`)
4. TypeScript typecheck & Vite production bundle (`npx tsc --noEmit && npm run build`)
5. Unit test execution (`npm test`)
6. Multi-stage Docker image build & tagging
7. Credential-managed SSH deployment to the production host
8. Idempotent database schema/migration verification
9. Healthcheck verification (`/api/health?strict=true`) and rollback guidance

## Required Jenkins Plugins

- **Pipeline** (`workflow-aggregator`)
- **Git**
- **Credentials Binding**
- **SSH Agent**

## Configure Jenkins Credentials

Go to **Manage Jenkins → Credentials → System → Global credentials** and add:

| Credential ID | Kind | Purpose |
| --- | --- | --- |
| `dharani-prod-host` | Secret text | Production server IP or domain |
| `dharani-db-user` | Secret text | Production MySQL application username |
| `dharani-db-password` | Secret text | Production MySQL application password |
| `dharani-mysql-root-pw` | Secret text | Production MySQL root password |
| `dharani-sync-secret` | Secret text | Shared `x-sync-secret` for `/api/sync/push` |
| `dharani-prod-ssh` | SSH Username with private key | SSH user + private key for deployment |

> All credentials are injected inside `withCredentials(...)` blocks and written with `chmod 600` on the target server without printing secrets to console output.

## Creating the Pipeline Job

1. Click **New Item** → name it `dharani-weighbridge-deploy` → select **Pipeline**.
2. Under **Pipeline**, choose **Pipeline script from SCM** → **Git**.
3. Set Repository URL and Branch (`*/main`).
4. Set Script Path to `Jenkinsfile`.
5. Save and click **Build Now**.

## Zero-Downtime & Data Preservation

- Deployment updates `backend`, `sync-worker`, and `frontend` using `docker compose up -d --no-deps`.
- `database` and its persistent volume `rmc_mysql_data` are never dropped or recreated.

## Rollback Procedure

If a deployment fails or fails health checks:

```bash
cd /opt/dharani-weighbridge
docker images dharani-weighbridge-backend
# Update IMAGE_TAG in /opt/dharani-weighbridge/.env to the previous working tag
docker compose up -d --no-deps backend frontend sync-worker
curl -fs http://127.0.0.1:8080/api/health?strict=true
```
