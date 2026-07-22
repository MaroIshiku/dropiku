import { access, constants, statfs } from "node:fs/promises";
import { eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { appState, capabilitySessions, downloadShares, files, ownerConfig, recoveryCodes, sessions, uploadRequests } from "../schema.js";
import { listAudit, writeAudit } from "../security/audit.js";
import { decryptSmallSecret, sourceIpHash } from "../security/primitives.js";
import { requireOwner, requireOwnerCsrf, revokeAllSessions } from "../security/sessions.js";
import { verifyTotp } from "../security/totp.js";
import { errorSchema, sendError } from "../http.js";

declare const __APP_VERSION__: string | undefined;
declare const __BUILD_DATE__: string | undefined;
declare const __GIT_SHA__: string | undefined;

function buildInfo() {
  return {
    version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : process.env.APP_VERSION ?? "0.1.0",
    buildDate: typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : process.env.BUILD_DATE ?? "development",
    gitSha: typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : process.env.GIT_SHA ?? "development",
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/api/activity", { preHandler: requireOwner, schema: { tags: ["Activity"], querystring: { type: "object", additionalProperties: false, properties: { limit: { type: "string", pattern: "^[0-9]+$" } } }, response: { 200: { type: "object", required: ["events"], properties: { events: { type: "array", items: { type: "object", additionalProperties: true } } } }, 401: errorSchema } } }, async (request) => ({ events: listAudit(app.database, Number(request.query.limit ?? 100)) }));

  app.get("/api/admin/diagnostics", { preHandler: requireOwner, schema: { tags: ["Admin"], response: { 200: { type: "object", additionalProperties: true }, 401: errorSchema } } }, async () => {
    let storageWritable = false;
    let databaseWritable = false;
    let diskFreeBytes = 0;
    try { await access(app.appConfig.filesDir, constants.R_OK | constants.W_OK); storageWritable = true; } catch { storageWritable = false; }
    try { app.database.sqlite.prepare("SELECT 1").get(); databaseWritable = !app.database.sqlite.readonly; } catch { databaseWritable = false; }
    try { const stats = await statfs(app.appConfig.dataDir); diskFreeBytes = Number(stats.bavail * stats.bsize); } catch { diskFreeBytes = 0; }
    const storage = app.database.orm.select({ bytes: sql<number>`COALESCE(SUM(${files.sizeBytes}), 0)`, count: sql<number>`COUNT(*)` }).from(files).where(eq(files.deletionState, "active")).get();
    return {
      ...buildInfo(), serverTime: new Date().toISOString(), dataDirectory: app.appConfig.dataDir,
      database: { readable: true, writable: databaseWritable, wal: app.database.sqlite.pragma("journal_mode", { simple: true }) === "wal" },
      storage: { readable: storageWritable, writable: storageWritable, usedBytes: storage?.bytes ?? 0, fileCount: storage?.count ?? 0, configuredLimitBytes: app.appConfig.maxStorageBytes, diskFreeBytes },
      workers: { cleanup: "running" }, clamav: { configured: Boolean(app.appConfig.clamavHost), status: app.appConfig.clamavHost ? "not_connected" : "not_configured" },
      sessions: { active: app.database.orm.select().from(sessions).where(isNull(sessions.revokedAt)).all().length },
      links: { downloadShares: app.database.orm.select().from(downloadShares).where(isNull(downloadShares.revokedAt)).all().length, uploadRequests: app.database.orm.select().from(uploadRequests).where(isNull(uploadRequests.revokedAt)).all().length },
    };
  });

  app.get("/api/admin/logs", { preHandler: requireOwner, schema: { tags: ["Admin"], response: { 200: { type: "object", required: ["events"], properties: { events: { type: "array", items: { type: "object", additionalProperties: true } } } }, 401: errorSchema } } }, async () => ({ events: listAudit(app.database, 250) }));

  app.post<{ Body: { code: string } }>("/api/security/recovery-codes/regenerate", { preHandler: requireOwnerCsrf, schema: { tags: ["Security"], body: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", pattern: "^(?:[0-9]{6}|[0-9]{10})$" } } }, response: { 200: { type: "object", required: ["recoveryCodes"], properties: { recoveryCodes: { type: "array", items: { type: "string" } } } }, 400: errorSchema, 401: errorSchema, 403: errorSchema } } }, async (request, reply) => {
    const owner = app.database.orm.select().from(ownerConfig).get();
    if (!owner) return sendError(reply, 400, "setup_required", "Setup is required.");
    const step = verifyTotp(decryptSmallSecret(app.appConfig, owner.encryptedTotpSecret), request.body.code, Date.now(), owner.totpDigits === 6 ? 6 : 10);
    if (step === null || (owner.lastAcceptedTotpStep !== null && step <= owner.lastAcceptedTotpStep)) return sendError(reply, 400, "invalid_code", "The code could not be accepted.");
    const { randomToken } = await import("../security/primitives.js");
    const { randomUUID } = await import("node:crypto");
    const argon2 = (await import("argon2")).default;
    const codes = Array.from({ length: 10 }, () => randomToken(16));
    const hashes = await Promise.all(codes.map((code) => argon2.hash(code, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })));
    app.database.sqlite.transaction(() => {
      app.database.orm.delete(recoveryCodes).run();
      hashes.forEach((hash) => app.database.orm.insert(recoveryCodes).values({ id: randomUUID(), argon2idHash: hash, usedAt: null, createdAt: Date.now() }).run());
      app.database.orm.update(ownerConfig).set({ lastAcceptedTotpStep: step, updatedAt: Date.now() }).where(eq(ownerConfig.singletonId, 1)).run();
    })();
    writeAudit(app.database, "recovery_codes_regenerated", { severity: "warn", actorType: "owner", sourceIpHash: sourceIpHash(app.appConfig, request.ip) });
    return { recoveryCodes: codes };
  });

  app.post("/api/security/revoke-public-links", { preHandler: requireOwnerCsrf, schema: { tags: ["Security"], response: { 204: { type: "null" }, 401: errorSchema, 403: errorSchema } } }, async (_request, reply) => {
    const now = Date.now();
    app.database.sqlite.transaction(() => {
      app.database.orm.update(downloadShares).set({ revokedAt: now }).where(isNull(downloadShares.revokedAt)).run();
      app.database.orm.update(uploadRequests).set({ revokedAt: now }).where(isNull(uploadRequests.revokedAt)).run();
      app.database.orm.delete(capabilitySessions).run();
    })();
    writeAudit(app.database, "all_public_links_revoked", { severity: "warn", actorType: "owner" });
    return reply.code(204).send();
  });

  app.post("/api/security/logout-all", { preHandler: requireOwnerCsrf, schema: { tags: ["Security"], response: { 204: { type: "null" }, 401: errorSchema, 403: errorSchema } } }, async (_request, reply) => {
    revokeAllSessions(app.database);
    writeAudit(app.database, "owner_logout_all", { severity: "warn", actorType: "owner" });
    return reply.code(204).send();
  });

  app.post<{ Body: { enabled: boolean } }>("/api/admin/maintenance", { preHandler: requireOwnerCsrf, schema: { tags: ["Admin"], body: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" } } }, response: { 200: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } }, 401: errorSchema, 403: errorSchema } } }, async (request) => {
    app.database.orm.insert(appState).values({ key: "maintenance_mode", value: request.body.enabled ? "1" : "0", updatedAt: Date.now() }).onConflictDoUpdate({ target: appState.key, set: { value: request.body.enabled ? "1" : "0", updatedAt: Date.now() } }).run();
    return { enabled: request.body.enabled };
  });
}
