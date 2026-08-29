FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    WORKANA_WEB_PORT=8081 \
    DATA_DIR=/data \
    CHROMIUM_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    TZ=Europe/Madrid

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

RUN mkdir -p /data \
    && chown node:node /data

USER node

EXPOSE 8081
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8081/api/refresh-status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
