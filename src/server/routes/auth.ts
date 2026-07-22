import argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { appState, ownerConfig, recoveryCodes, sessions } from "../schema.js";
import { decryptSmallSecret, randomToken, sha256, sourceIpHash } from "../security/primitives.js";
import { verifyTotp } from "../security/totp.js";
import { consumeRateLimit, resetRateLimit } from "../security/rate-limit.js";
import { clearOwnerCookie, createOwnerSession, requireOwner, requireOwnerCsrf, revokeAllSessions } from "../security/sessions.js";
import { writeAudit } from "../security/audit.js";
import { errorSchema, sendError } from "../http.js";

const genericLoginMessage = "The code could not be accepted. Check it and try again.";

async function minimumResponseTime(started: number): Promise<void> {
  const wait = 350 - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/session", { preHandler: requireOwner, schema: { tags: ["Authentication"], response: { 200: { type: "object", required: ["authenticated", "csrfToken", "recoveryRequired"], properties: { authenticated: { type: "boolean" }, csrfToken: { type: "string" }, recoveryRequired: { type: "boolean" } } }, 401: errorSchema } } }, async (request) => {
    const owner = app.database.orm.select({ recoveryRequiredAt: ownerConfig.recoveryRequiredAt }).from(ownerConfig).get();
    const csrfToken = request.cookies[app.appConfig.secureCookies ? "__Host-dropiku_csrf_hint" : "dropiku_csrf_hint"] ?? "";
    return { authenticated: true, csrfToken, recoveryRequired: Boolean(owner?.recoveryRequiredAt) };
  });

  app.post<{ Body: { code: string } }>("/api/auth/totp/login", {
    schema: { tags: ["Authentication"], body: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", pattern: "^[0-9]{10}$" } } }, response: { 200: { type: "object", required: ["authenticated", "csrfToken"], properties: { authenticated: { type: "boolean" }, csrfToken: { type: "string" } } }, 401: errorSchema, 429: errorSchema } },
  }, async (request, reply) => {
    const started = Date.now();
    const ipHash = sourceIpHash(app.appConfig, request.ip);
    const schedule = [30, 60, 300, 900, 3600] as const;
    const ipDecision = consumeRateLimit(app.database, app.appConfig, { bucket: "owner-login-ip", key: ipHash, limit: 5, windowMs: 5 * 60_000, escalationSeconds: schedule });
    const globalDecision = consumeRateLimit(app.database, app.appConfig, { bucket: "owner-login-global", key: "global", limit: 100, windowMs: 10 * 60_000, escalationSeconds: [600] });
    if (!ipDecision.allowed || !globalDecision.allowed) {
      const retry = Math.max(ipDecision.retryAfterSeconds, globalDecision.retryAfterSeconds);
      reply.header("Retry-After", retry);
      await minimumResponseTime(started);
      return sendError(reply, 429, "try_again_later", genericLoginMessage);
    }
    const owner = app.database.orm.select().from(ownerConfig).get();
    let accepted = false;
    if (owner && !owner.recoveryRequiredAt) {
      const step = verifyTotp(decryptSmallSecret(app.appConfig, owner.encryptedTotpSecret), request.body.code);
      if (step !== null && (owner.lastAcceptedTotpStep === null || step > owner.lastAcceptedTotpStep)) {
        const result = app.database.sqlite.prepare("UPDATE owner_config SET last_accepted_totp_step = ?, updated_at = ? WHERE singleton_id = 1 AND (last_accepted_totp_step IS NULL OR last_accepted_totp_step < ?)").run(step, Date.now(), step);
        accepted = result.changes === 1;
      }
    }
    await minimumResponseTime(started);
    if (!accepted) {
      writeAudit(app.database, "owner_login_failed", { severity: "warn", actorType: "anonymous", sourceIpHash: ipHash });
      return sendError(reply, 401, "invalid_login", genericLoginMessage);
    }
    resetRateLimit(app.database, app.appConfig, "owner-login-ip", ipHash);
    writeAudit(app.database, "owner_login_success", { actorType: "owner", sourceIpHash: ipHash });
    const result = createOwnerSession(app.database, app.appConfig, request, reply);
    const csrfCookie = app.appConfig.secureCookies ? "__Host-dropiku_csrf_hint" : "dropiku_csrf_hint";
    reply.setCookie(csrfCookie, result.csrfToken, { path: "/", httpOnly: true, secure: app.appConfig.secureCookies, sameSite: "strict", maxAge: 12 * 60 * 60 });
    return { authenticated: true, ...result };
  });

  app.post<{ Body: { recoveryCode: string } }>("/api/auth/recovery/login", {
    schema: { tags: ["Authentication"], body: { type: "object", additionalProperties: false, required: ["recoveryCode"], properties: { recoveryCode: { type: "string", minLength: 16, maxLength: 128 } } }, response: { 200: { type: "object", required: ["authenticated", "resetRequired"], properties: { authenticated: { type: "boolean" }, resetRequired: { type: "boolean" } } }, 401: errorSchema, 429: errorSchema } },
  }, async (request, reply) => {
    const started = Date.now();
    const ipHash = sourceIpHash(app.appConfig, request.ip);
    const decision = consumeRateLimit(app.database, app.appConfig, { bucket: "recovery-login", key: ipHash, limit: 5, windowMs: 60 * 60_000, escalationSeconds: [60, 300, 900, 3600] });
    if (!decision.allowed) {
      reply.header("Retry-After", decision.retryAfterSeconds);
      await minimumResponseTime(started);
      return sendError(reply, 429, "try_again_later", genericLoginMessage);
    }
    const codes = app.database.orm.select().from(recoveryCodes).where(isNull(recoveryCodes.usedAt)).all();
    let matched: (typeof codes)[number] | undefined;
    for (const code of codes) {
      if (await argon2.verify(code.argon2idHash, request.body.recoveryCode)) matched = code;
    }
    await minimumResponseTime(started);
    if (!matched) {
      writeAudit(app.database, "recovery_login_failed", { severity: "warn", actorType: "anonymous", sourceIpHash: ipHash });
      return sendError(reply, 401, "invalid_login", genericLoginMessage);
    }
    const now = Date.now();
    const resetToken = randomToken(32);
    app.database.sqlite.transaction(() => {
      app.database.orm.update(recoveryCodes).set({ usedAt: now }).where(and(eq(recoveryCodes.id, matched.id), isNull(recoveryCodes.usedAt))).run();
      revokeAllSessions(app.database, now);
      app.database.orm.delete(recoveryCodes).run();
      app.database.orm.delete(ownerConfig).where(eq(ownerConfig.singletonId, 1)).run();
      app.database.orm.insert(appState).values({ key: "recovery_setup_authorization", value: JSON.stringify({ tokenHash: sha256(resetToken), expiresAt: now + 20 * 60_000 }), updatedAt: now }).onConflictDoUpdate({ target: appState.key, set: { value: JSON.stringify({ tokenHash: sha256(resetToken), expiresAt: now + 20 * 60_000 }), updatedAt: now } }).run();
    })();
    writeAudit(app.database, "recovery_login_success", { severity: "warn", actorType: "owner", sourceIpHash: ipHash });
    reply.setCookie(app.appConfig.secureCookies ? "__Host-dropiku_recovery_setup" : "dropiku_recovery_setup", resetToken, { path: "/", httpOnly: true, secure: app.appConfig.secureCookies, sameSite: "strict", maxAge: 20 * 60 });
    return { authenticated: false, resetRequired: true };
  });

  app.post("/api/auth/logout", { preHandler: requireOwnerCsrf, schema: { tags: ["Authentication"], response: { 204: { type: "null" }, 401: errorSchema, 403: errorSchema } } }, async (request, reply) => {
    if (request.ownerSession) app.database.orm.update(sessions).set({ revokedAt: Date.now() }).where(eq(sessions.id, request.ownerSession.id)).run();
    clearOwnerCookie(app.appConfig, reply);
    return reply.code(204).send();
  });

  app.post("/api/auth/logout-all", { preHandler: requireOwnerCsrf, schema: { tags: ["Authentication"], response: { 204: { type: "null" }, 401: errorSchema, 403: errorSchema } } }, async (_request, reply) => {
    revokeAllSessions(app.database);
    clearOwnerCookie(app.appConfig, reply);
    writeAudit(app.database, "owner_logout_all", { actorType: "owner" });
    return reply.code(204).send();
  });
}
