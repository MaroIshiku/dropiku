# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app
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

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS runtime
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
