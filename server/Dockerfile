# Tally sync server + web app in one small image (works on Raspberry Pi / arm64).
# Build from the repository root:
#   docker build -f server/Dockerfile -t tally-server .
FROM node:22-alpine AS web
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production TALLY_HOST=0.0.0.0 TALLY_PORT=8787 TALLY_DATA_DIR=/data TALLY_STATIC_DIR=/app/app/dist
WORKDIR /app/server
COPY server/package.json ./
COPY server/src ./src
COPY --from=web /src/app/dist /app/app/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/v1/health || exit 1
CMD ["node", "src/index.js", "serve"]
