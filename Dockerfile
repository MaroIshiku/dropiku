# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts vitest.config.ts eslint.config.js ./
COPY design-system ./design-system
COPY public ./public
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26-bookworm-slim AS runtime
ARG APP_VERSION=0.1.0
ARG BUILD_DATE=unknown
ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    APP_VERSION=${APP_VERSION} \
    BUILD_DATE=${BUILD_DATE} \
    GIT_SHA=${GIT_SHA}
WORKDIR /app
RUN groupadd --system --gid 10001 dropiku \
    && useradd --system --uid 10001 --gid dropiku --home-dir /app --shell /usr/sbin/nologin dropiku \
    && mkdir -p /data/database /data/files /data/tmp /data/quarantine /data/logs \
    && chown -R dropiku:dropiku /data /app
COPY --from=build --chown=dropiku:dropiku /app/package.json /app/package-lock.json ./
COPY --from=build --chown=dropiku:dropiku /app/node_modules ./node_modules
COPY --from=build --chown=dropiku:dropiku /app/dist ./dist
USER dropiku
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/index.js"]
