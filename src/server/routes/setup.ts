import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { appState, ownerConfig, recoveryCodes } from "../schema.js";
import { constantTimeEqual, encryptSmallSecret, randomToken, sha256, sourceIpHash } from "../security/primitives.js";
import { generateTotp, verifyTotp } from "../security/totp.js";
import { consumeRateLimit } from "../security/rate-limit.js";
import { createOwnerSession } from "../security/sessions.js";
import { writeAudit } from "../security/audit.js";
import { errorSchema, sendError } from "../http.js";

interface SetupState {
  secret: string;
  uri: string;
  firstStep?: number;
  verifiedStep?: number;
  recoveryCodes?: string[];
  recoveryHashes?: string[];
  expiresAt: number;
}

const setupStates = new Map<string, SetupState>();

function setupComplete(app: FastifyInstance): boolean {
  return Boolean(app.database.orm.select({ id: ownerConfig.singletonId }).from(ownerConfig).where(eq(ownerConfig.singletonId, 1)).get());
}

function setupCookie(app: FastifyInstance): string {
  return app.appConfig.secureCookies ? "__Host-dropiku_setup" : "dropiku_setup";
}

function recoverySetupCookie(app: FastifyInstance): string {
  return app.appConfig.secureCookies ? "__Host-dropiku_recovery_setup" : "dropiku_recovery_setup";
}

function recoveryAuthorization(app: FastifyInstance, token: string | undefined): boolean {
  if (!token) return false;
  const record = app.database.orm.select().from(appState).where(eq(appState.key, "recovery_setup_authorization")).get();
  if (!record) return false;
  try {
    const value = JSON.parse(record.value) as { tokenHash: string; expiresAt: number };
    return value.expiresAt > Date.now() && constantTimeEqual(value.tokenHash, sha256(token));
  } catch { return false; }
}

function stateFor(app: FastifyInstance, token: string | undefined): SetupState | undefined {
  if (!token) return undefined;
  const state = setupStates.get(token);
  if (!state || state.expiresAt < Date.now()) {
    setupStates.delete(token);
    return undefined;
  }
  return state;
}

async function fixedDelay(started: number): Promise<void> {
  const wait = 350 - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/setup/status", {
    schema: { tags: ["Setup"], response: { 200: { type: "object", required: ["setupRequired", "recoveryAuthorized"], properties: { setupRequired: { type: "boolean" }, recoveryAuthorized: { type: "boolean" } } } } },
  }, async (request) => ({ setupRequired: !setupComplete(app), recoveryAuthorized: recoveryAuthorization(app, request.cookies[recoverySetupCookie(app)]) }));

  app.post<{ Body: { setupSecret: string } }>("/api/setup/unlock", {
    schema: {
      tags: ["Setup"], body: { type: "object", additionalProperties: false, required: ["setupSecret"], properties: { setupSecret: { type: "string", maxLength: 4096 } } },
      response: { 200: { type: "object", required: ["secret", "uri", "qrDataUrl"], properties: { secret: { type: "string" }, uri: { type: "string" }, qrDataUrl: { type: "string" } } }, 400: errorSchema, 409: errorSchema, 429: errorSchema },
    },
  }, async (request, reply) => {
    if (setupComplete(app)) return sendError(reply, 409, "setup_closed", "Setup has already been completed.");
    const started = Date.now();
    const source = sourceIpHash(app.appConfig, request.ip);
    const ipDecision = consumeRateLimit(app.database, app.appConfig, { bucket: "setup-ip", key: source, limit: 5, windowMs: 15 * 60_000 });
    const globalDecision = consumeRateLimit(app.database, app.appConfig, { bucket: "setup-global", key: "global", limit: 20, windowMs: 60 * 60_000 });
    if (!ipDecision.allowed || !globalDecision.allowed) {
      const retry = Math.max(ipDecision.retryAfterSeconds, globalDecision.retryAfterSeconds);
      reply.header("Retry-After", retry);
      await fixedDelay(started);
      return sendError(reply, 429, "try_again_later", "Setup could not be unlocked. Try again later.");
    }
    const recoveryPending = Boolean(app.database.orm.select().from(appState).where(eq(appState.key, "recovery_setup_authorization")).get());
    const recoveryAuthorized = recoveryAuthorization(app, request.cookies[recoverySetupCookie(app)]);
    if ((recoveryPending && !recoveryAuthorized) || (!recoveryPending && !constantTimeEqual(request.body.setupSecret, app.appConfig.setupSecret))) {
      writeAudit(app.database, "setup_unlock_failed", { severity: "warn", actorType: "anonymous", sourceIpHash: source });
      await fixedDelay(started);
      return sendError(reply, 400, "setup_failed", "Setup could not be unlocked.");
    }
    const label = new URL(app.appConfig.appBaseUrl).hostname;
    const material = generateTotp(label);
    const token = randomToken(32);
    setupStates.set(token, { ...material, expiresAt: Date.now() + 20 * 60_000 });
    reply.setCookie(setupCookie(app), token, { path: "/", httpOnly: true, secure: app.appConfig.secureCookies, sameSite: "strict", maxAge: 20 * 60 });
    await fixedDelay(started);
    return { ...material, qrDataUrl: await QRCode.toDataURL(material.uri, { errorCorrectionLevel: "M", margin: 1, width: 280 }) };
  });

  app.post<{ Body: { code: string } }>("/api/setup/verify-totp", {
    schema: {
      tags: ["Setup"], body: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", pattern: "^[0-9]{10}$" } } },
      response: { 200: { type: "object", required: ["verified", "needsNextWindow"], properties: { verified: { type: "boolean" }, needsNextWindow: { type: "boolean" }, recoveryCodes: { type: "array", items: { type: "string" } } } }, 400: errorSchema, 401: errorSchema },
    },
  }, async (request, reply) => {
    if (setupComplete(app)) return sendError(reply, 400, "setup_closed", "Setup has already been completed.");
    const state = stateFor(app, request.cookies[setupCookie(app)]);
    if (!state) return sendError(reply, 401, "setup_session_expired", "Unlock setup again to continue.");
    const step = verifyTotp(state.secret, request.body.code);
    if (step === null) return sendError(reply, 400, "invalid_code", "The 10-digit code is not valid.");
    if (state.firstStep === undefined) {
      state.firstStep = step;
      return { verified: false, needsNextWindow: true };
    }
    if (step === state.firstStep) return sendError(reply, 400, "same_time_window", "Wait for the next 30-second code and try again.");
    if (step < state.firstStep) return sendError(reply, 400, "invalid_code", "The 10-digit code is not valid.");
    state.verifiedStep = step;
    if (!state.recoveryCodes) {
      state.recoveryCodes = Array.from({ length: 10 }, () => randomToken(16));
      state.recoveryHashes = await Promise.all(state.recoveryCodes.map((code) => argon2.hash(code, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })));
    }
    return { verified: true, needsNextWindow: false, recoveryCodes: state.recoveryCodes };
  });

  app.post<{ Body: { recoveryCodesSaved: boolean } }>("/api/setup/finish", {
    schema: {
      tags: ["Setup"], body: { type: "object", additionalProperties: false, required: ["recoveryCodesSaved"], properties: { recoveryCodesSaved: { const: true } } },
      response: { 200: { type: "object", required: ["configured", "csrfToken"], properties: { configured: { type: "boolean" }, csrfToken: { type: "string" } } }, 400: errorSchema, 401: errorSchema, 409: errorSchema },
    },
  }, async (request, reply) => {
    if (setupComplete(app)) return sendError(reply, 409, "setup_closed", "Setup has already been completed.");
    const token = request.cookies[setupCookie(app)];
    const state = stateFor(app, token);
    if (!state?.recoveryCodes || !state.recoveryHashes || state.firstStep === undefined) return sendError(reply, 401, "setup_incomplete", "Complete TOTP verification first.");
    const now = Date.now();
    app.database.sqlite.transaction(() => {
      app.database.orm.insert(ownerConfig).values({
        singletonId: 1, encryptedTotpSecret: encryptSmallSecret(app.appConfig, state.secret), lastAcceptedTotpStep: state.verifiedStep ?? state.firstStep,
        setupCompletedAt: now, createdAt: now, updatedAt: now,
      }).run();
      state.recoveryHashes!.forEach((hash) => app.database.orm.insert(recoveryCodes).values({ id: randomUUID(), argon2idHash: hash, usedAt: null, createdAt: now }).run());
    })();
    if (token) setupStates.delete(token);
    reply.clearCookie(setupCookie(app), { path: "/" });
    reply.clearCookie(recoverySetupCookie(app), { path: "/" });
    app.database.orm.delete(appState).where(eq(appState.key, "recovery_setup_authorization")).run();
    writeAudit(app.database, "setup_completed", { actorType: "owner", sourceIpHash: sourceIpHash(app.appConfig, request.ip) });
    return { configured: true, ...createOwnerSession(app.database, app.appConfig, request, reply) };
  });
}
