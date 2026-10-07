# Tally sync server + web app in one small image (amd64, arm64 — Raspberry Pi 4/5 —, armv7).
#
# Prebuilt:  docker pull ghcr.io/lukajakimovski/tally-server:latest
# Build:     docker build -f server/Dockerfile -t tally-server .   (from the repository root)

# The web app is plain static files, so build it once on the build machine's
# own architecture (fast) instead of under emulation for every target.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY app/ ./
RUN npm run build

FROM node:22-alpine
LABEL org.opencontainers.image.title="Tally sync server" \
      org.opencontainers.image.description="Self-hosted sync and backup server for Tally (serves the web app too)" \
      org.opencontainers.image.source="https://github.com/LukaJakimovski/budgeting_tool" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    TALLY_HOST=0.0.0.0 \
    TALLY_PORT=8787 \
    TALLY_DATA_DIR=/data \
    TALLY_STATIC_DIR=/app/app/dist
WORKDIR /app/server
COPY server/package.json ./
COPY server/src ./src
COPY --from=web /src/app/dist /app/app/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/v1/health >/dev/null || exit 1
CMD ["node", "src/index.js", "serve"]
