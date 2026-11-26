# ==============================================================================
# Dockerfile for Dharani Weighbridge Backend & Sync Worker (Node.js 20)
# ==============================================================================

FROM node:20-alpine

WORKDIR /app

# Install runtime utilities (tzdata for local timestamps, curl for healthchecks)
RUN apk add --no-cache tzdata curl

# Copy backend dependency manifests
COPY package*.json ./

# Install production dependencies only
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy backend application code
COPY . .

# Ensure runtime directories exist
RUN mkdir -p /app/public/snapshots /app/logs

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fs http://127.0.0.1:3001/api/health?strict=true || exit 1

CMD ["node", "index.js"]
