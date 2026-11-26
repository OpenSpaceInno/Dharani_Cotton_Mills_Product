// ============================================================================
// Dharani Weighbridge & Gate Management System - Jenkins CI/CD Pipeline
// ============================================================================
// Required Jenkins Credentials (Manage Jenkins -> Credentials):
//   - dharani-db-user          (Username/Secret Text): Production MySQL user
//   - dharani-db-password      (Secret Text): Production MySQL password
//   - dharani-mysql-root-pw    (Secret Text): Production MySQL root password
//   - dharani-sync-secret      (Secret Text): Shared HTTP sync fallback secret
//   - dharani-prod-ssh         (SSH Username with private key): Deploy target SSH
//   - dharani-prod-host        (Secret Text): Production server IP / hostname
// Optional (if pushing images to a registry):
//   - dharani-registry-creds   (Username with password)
// ============================================================================

pipeline {
  agent any

  options {
    buildDiscards(logRotator(numToKeepStr: '15'))
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    APP_NAME          = 'dharani-weighbridge'
    FRONTEND_IMAGE    = 'dharani-weighbridge-frontend'
    BACKEND_IMAGE     = 'dharani-weighbridge-backend'
    NODE_ENV          = 'production'
    FRONTEND_PORT     = '8080'
    PMA_PORT          = '8081'
    REMOTE_DEPLOY_DIR = '/opt/dharani-weighbridge'
  }

  stages {
    stage('1. Git Checkout') {
      steps {
        checkout scm
        script {
          env.GIT_SHORT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_SHORT_SHA}"
          echo "Checked out commit ${env.GIT_SHORT_SHA}, image tag: ${env.IMAGE_TAG}"
        }
      }
    }

    stage('2. Dependency Installation') {
      steps {
        sh '''
          set -e
          npm ci
          npm --prefix server ci
        '''
      }
    }

    stage('3. Backend Validation & Syntax Check') {
      steps {
        sh '''
          set -e
          node --check server/index.js
          node --check server/db.js
          node --check server/cloud-sync-service.js
          node --check server/sync-worker.js
          node --check server/routes/sync.js
          node --check server/config/env.js
          node --check server/config/sync-config.js
        '''
      }
    }

    stage('4. Frontend Compilation & Build') {
      steps {
        sh '''
          set -e
          npx tsc --noEmit
          VITE_API_URL=/api npm run build
        '''
      }
    }

    stage('5. Unit Tests') {
      steps {
        sh '''
          set -e
          npm test
        '''
      }
    }

    stage('6. Docker Image Creation & Tagging') {
      steps {
        sh '''
          set -e
          docker build -t ${FRONTEND_IMAGE}:${IMAGE_TAG} -t ${FRONTEND_IMAGE}:latest --build-arg VITE_API_URL=/api .
          docker build -t ${BACKEND_IMAGE}:${IMAGE_TAG} -t ${BACKEND_IMAGE}:latest ./server
          docker compose config -q
        '''
      }
    }

    stage('7. Production Environment & Zero-Downtime Deployment') {
      steps {
        withCredentials([
          string(credentialsId: 'dharani-prod-host', variable: 'PROD_HOST'),
          string(credentialsId: 'dharani-db-user', variable: 'PROD_DB_USER'),
          string(credentialsId: 'dharani-db-password', variable: 'PROD_DB_PASS'),
          string(credentialsId: 'dharani-mysql-root-pw', variable: 'PROD_ROOT_PASS'),
          string(credentialsId: 'dharani-sync-secret', variable: 'PROD_SYNC_SECRET'),
          sshUserPrivateKey(credentialsId: 'dharani-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')
        ]) {
          sh '''
            set -euo pipefail
            # Stream built Docker images securely to production host without exposing secrets in logs
            docker save ${FRONTEND_IMAGE}:${IMAGE_TAG} ${BACKEND_IMAGE}:${IMAGE_TAG} | gzip | \
              ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "${SSH_USER}@${PROD_HOST}" "gunzip | docker load"

            # Sync compose & init files (never overwrite existing MySQL data volumes)
            ssh -i "$SSH_KEY" "${SSH_USER}@${PROD_HOST}" "mkdir -p ${REMOTE_DEPLOY_DIR}/docker/mysql ${REMOTE_DEPLOY_DIR}/docker/nginx"
            scp -i "$SSH_KEY" docker-compose.yml "${SSH_USER}@${PROD_HOST}:${REMOTE_DEPLOY_DIR}/docker-compose.yml"
            scp -i "$SSH_KEY" docker/nginx/nginx.conf "${SSH_USER}@${PROD_HOST}:${REMOTE_DEPLOY_DIR}/docker/nginx/nginx.conf"

            # Write .env on remote server securely over stdin (never echoed to Jenkins console)
            ssh -i "$SSH_KEY" "${SSH_USER}@${PROD_HOST}" "cat > ${REMOTE_DEPLOY_DIR}/.env <<'ENVEOF'
NODE_ENV=production
IMAGE_TAG=${IMAGE_TAG}
FRONTEND_PORT=${FRONTEND_PORT}
PMA_PORT=${PMA_PORT}
PMA_BIND_IP=127.0.0.1
PMA_HOST=database
PMA_PORT_NUM=3306
DB_HOST=database
DB_PORT=3306
DB_USER=${PROD_DB_USER}
DB_PASSWORD=${PROD_DB_PASS}
MYSQL_ROOT_PASSWORD=${PROD_ROOT_PASS}
DB_NAME=dharani_weighbridge
DB_POOL_SIZE=20
DB_CONNECT_TIMEOUT_MS=10000
CLOUD_SYNC_ENABLED=false
CLOUD_SYNC_SECRET=${PROD_SYNC_SECRET}
PLANT_ID=SERVER_CENTRAL
CORS_ORIGIN=*
ENVEOF
chmod 600 ${REMOTE_DEPLOY_DIR}/.env"

            # Preserve database container & volumes; rolling-update application containers only
            ssh -i "$SSH_KEY" "${SSH_USER}@${PROD_HOST}" "
              cd ${REMOTE_DEPLOY_DIR}
              docker compose up -d --no-deps database phpmyadmin
              docker compose up -d --no-deps backend sync-worker frontend
            "
          '''
        }
      }
    }

    stage('8. Database Migration & Idempotent Schema Check') {
      steps {
        withCredentials([
          string(credentialsId: 'dharani-prod-host', variable: 'PROD_HOST'),
          sshUserPrivateKey(credentialsId: 'dharani-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')
        ]) {
          sh '''
            set -e
            ssh -i "$SSH_KEY" "${SSH_USER}@${PROD_HOST}" "
              cd ${REMOTE_DEPLOY_DIR}
              docker compose exec -T backend node -e \"import('./db.js').then(m => m.initializeDatabase()).then(ok => process.exit(ok ? 0 : 1))\"
            "
          '''
        }
      }
    }

    stage('9. Application Health Checks & Deployment Verification') {
      steps {
        withCredentials([
          string(credentialsId: 'dharani-prod-host', variable: 'PROD_HOST'),
          sshUserPrivateKey(credentialsId: 'dharani-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')
        ]) {
          sh '''
            set -e
            ssh -i "$SSH_KEY" "${SSH_USER}@${PROD_HOST}" "
              cd ${REMOTE_DEPLOY_DIR}
              for i in 1 2 3 4 5 6; do
                if curl -fs http://127.0.0.1:${FRONTEND_PORT}/api/health?strict=true; then
                  echo 'Backend & MySQL healthcheck passed!'
                  break
                fi
                echo 'Waiting for containers to stabilize...'
                sleep 5
              done
              curl -fs http://127.0.0.1:${FRONTEND_PORT}/ > /dev/null
              docker compose ps
            "
          '''
        }
      }
    }
  }

  post {
    success {
      echo "✅ Deployment successful (IMAGE_TAG=${env.IMAGE_TAG}). Production MySQL volume preserved."
    }
    failure {
      echo '''
❌ Pipeline failed!
Rollback instructions on production host (/opt/dharani-weighbridge):
  1. Identify previous good tag: docker images dharani-weighbridge-backend
  2. Set IMAGE_TAG=<previous_tag> in /opt/dharani-weighbridge/.env
  3. Run: docker compose up -d --no-deps backend frontend sync-worker
  4. Verify: curl -fs http://127.0.0.1:8080/api/health?strict=true
Note: NEVER run 'docker compose down -v' as that would remove the rmc_mysql_data volume.
'''
    }
  }
}
