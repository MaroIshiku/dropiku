import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { AppConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { ensureStorage } from "./storage.js";
import { setupRoutes } from "./routes/setup.js";
import { authRoutes } from "./routes/auth.js";
import { fileRoutes } from "./routes/files.js";
import { shareRoutes } from "./routes/shares.js";
import { requestRoutes } from "./routes/requests.js";
import { adminRoutes } from "./routes/admin.js";
import { errorSchema, sendError } from "./http.js";
import "./types.js";

export async function buildApp(config: AppConfig) {
  ensureStorage(config);
  const app = Fastify({
    trustProxy: config.trustProxy,
    logger: {
      level: config.logLevel,
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie", "*.secret", "*.token", "*.code", "*.recoveryCode", "*.setupSecret", "*.masterKey"],
        censor: "[REDACTED]",
      },
    },
    requestIdHeader: "x-request-id",
    bodyLimit: 1024 * 1024,
  });
  const database = createDatabase(config);
  app.decorate("appConfig", config);
  app.decorate("database", database);
  await app.register(cookie);
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], baseUri: ["'none'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"] } },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(multipart, { attachFieldsToBody: false, limits: { fileSize: config.absoluteMaxFileBytes, files: 100, parts: 120 } });
  await app.register(swagger, { openapi: { info: { title: "Dropiku API", version: "0.1.0", description: "Private file exchange API. Capability secrets are never part of documented URL paths." }, tags: [{ name: "Setup" }, { name: "Authentication" }, { name: "Files" }, { name: "Download shares" }, { name: "Upload requests" }, { name: "Public download" }, { name: "Public upload" }, { name: "Activity" }, { name: "Admin" }, { name: "Security" }] } });
  if (config.nodeEnv !== "production") await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-ID", request.id);
    if (request.url.startsWith("/api/public/") || request.url.startsWith("/api/auth/") || request.url.startsWith("/api/setup/")) reply.header("Cache-Control", "no-store, private");
    return payload;
  });

  app.get("/health/live", { schema: { hide: true, response: { 200: { type: "object", required: ["status"], properties: { status: { const: "ok" } } } } } }, async () => ({ status: "ok" }));
  app.get("/health/ready", { schema: { hide: true, response: { 200: { type: "object", required: ["status"], properties: { status: { const: "ready" } } }, 503: errorSchema } } }, async (_request, reply) => {
    try { database.sqlite.prepare("SELECT 1").get(); return { status: "ready" }; } catch { return sendError(reply, 503, "not_ready", "Dropiku is not ready."); }
  });

  await setupRoutes(app);
  await authRoutes(app);
  await fileRoutes(app);
  await shareRoutes(app);
  await requestRoutes(app);
  await adminRoutes(app);

  const clientRoot = resolve("dist/client");
  if (existsSync(clientRoot)) {
    await app.register(staticFiles, { root: clientRoot, prefix: "/", wildcard: false });
  }
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/health/")) return sendError(reply, 404, "not_found", "The requested endpoint was not found.");
    if (existsSync(resolve(clientRoot, "index.html"))) return reply.type("text/html").sendFile("index.html");
    return sendError(reply, 404, "client_not_built", "The web client has not been built yet.");
  });
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ err: error }, "Request failed.");
    if ((error as { validation?: unknown }).validation) return sendError(reply, 400, "validation_failed", "The request is not valid.");
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return sendError(reply, 413, "upload_too_large", "The upload is too large.");
    return sendError(reply, 500, "internal_error", "The request could not be completed.");
  });
  return app;
}
