# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts vitest.config.ts eslint.config.js ./
COPY design-system ./design-system
COPY public ./public
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev \
    && mkdir -p /runtime-data/database /runtime-data/files /runtime-data/tmp /runtime-data/quarantine /runtime-data/logs \
    && chown -R 10001:10001 /runtime-data

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:55de7e48a8414e7aff825207c0b3c0f7db3b10133efc50d748560c27c9053be1 AS runtime
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
COPY --from=build /usr/local/bin/node /nodejs/bin/node
COPY --from=build --chown=10001:10001 /runtime-data /data
COPY --from=build --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
USER 10001:10001
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["dist/server/index.js"]
