# ==============================================================================
# Multi-stage Dockerfile for Dharani Weighbridge Frontend (Vite + React + Nginx)
# ==============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install dependencies deterministically
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy application source
COPY . .

# Build-time API base URL (never bake DB credentials into frontend assets)
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Compile production Vite bundle to /app/dist
RUN npm run build

# Stage 2: Production Nginx Static & Reverse Proxy Server
FROM nginx:1.27-alpine

RUN rm -rf /usr/share/nginx/html/*

COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
