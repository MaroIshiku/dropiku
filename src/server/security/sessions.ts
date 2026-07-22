import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { capabilitySessions, sessions } from "../schema.js";
import { constantTimeEqual, ipPrefix, randomToken, sha256, sourceIpHash, userAgentHash } from "./primitives.js";
import { sendError } from "../http.js";

const OWNER_COOKIE_PROD = "__Host-dropiku_session";
const OWNER_COOKIE_DEV = "dropiku_session";
const CAPABILITY_COOKIE_PROD = "__Host-dropiku_capability";
const CAPABILITY_COOKIE_DEV = "dropiku_capability";

function ownerCookie(config: AppConfig): string {
  return config.secureCookies ? OWNER_COOKIE_PROD : OWNER_COOKIE_DEV;
}

function capabilityCookie(config: AppConfig): string {
  return config.secureCookies ? CAPABILITY_COOKIE_PROD : CAPABILITY_COOKIE_DEV;
}

function capabilityCsrfHintCookie(config: AppConfig): string {
  return config.secureCookies ? "__Host-dropiku_capability_csrf" : "dropiku_capability_csrf";
}

function csrfHintCookie(config: AppConfig): string {
  return config.secureCookies ? "__Host-dropiku_csrf_hint" : "dropiku_csrf_hint";
}

function cookieOptions(config: AppConfig, maxAge: number) {
  return { path: "/", httpOnly: true, secure: config.secureCookies, sameSite: "strict" as const, maxAge };
}

export function createOwnerSession(database: AppDatabase, config: AppConfig, request: FastifyRequest, reply: FastifyReply) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const now = Date.now();
  const idleMs = 30 * 60 * 1000;
  database.orm.insert(sessions).values({
    id: randomUUID(),
    tokenHash: sha256(token),
    csrfHash: sha256(csrf),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + idleMs,
    absoluteExpiresAt: now + 12 * 60 * 60 * 1000,
    ipPrefixHash: sourceIpHash(config, request.ip),
    userAgentHash: userAgentHash(config, request.headers["user-agent"] ?? ""),
    revokedAt: null,
  }).run();
  reply.setCookie(ownerCookie(config), token, cookieOptions(config, 12 * 60 * 60));
  reply.setCookie(csrfHintCookie(config), csrf, cookieOptions(config, 12 * 60 * 60));
  return { csrfToken: csrf };
}

export function clearOwnerCookie(config: AppConfig, reply: FastifyReply): void {
  reply.clearCookie(ownerCookie(config), cookieOptions(config, 0));
  reply.clearCookie(csrfHintCookie(config), cookieOptions(config, 0));
}

export async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const config = request.server.appConfig;
  const token = request.cookies[ownerCookie(config)];
  if (!token) {
    await sendError(reply, 401, "unauthorized", "Authentication is required.");
    return;
  }
  const now = Date.now();
  const row = request.server.database.orm.select().from(sessions).where(and(
    eq(sessions.tokenHash, sha256(token)),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, now),
    gt(sessions.absoluteExpiresAt, now),
  )).get();
  if (!row) {
    clearOwnerCookie(config, reply);
    await sendError(reply, 401, "unauthorized", "Authentication is required.");
    return;
  }
  request.ownerSession = { id: row.id, csrfHash: row.csrfHash };
  const nextExpiry = Math.min(now + 30 * 60 * 1000, row.absoluteExpiresAt);
  if (now - row.lastSeenAt > 60_000) {
    request.server.database.orm.update(sessions).set({ lastSeenAt: now, expiresAt: nextExpiry }).where(eq(sessions.id, row.id)).run();
  }
}

export async function requireOwnerCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireOwner(request, reply);
  if (reply.sent || !request.ownerSession) return;
  const token = request.headers["x-csrf-token"];
  if (typeof token !== "string" || !constantTimeEqual(sha256(token), request.ownerSession.csrfHash)) {
    await sendError(reply, 403, "invalid_csrf", "The request could not be verified.");
  }
}

export function createCapabilitySession(
  database: AppDatabase,
  config: AppConfig,
  request: FastifyRequest,
  reply: FastifyReply,
  scopeType: "download_share" | "upload_request",
  scopeId: string,
) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const now = Date.now();
  database.orm.insert(capabilitySessions).values({
    id: randomUUID(), tokenHash: sha256(token), csrfHash: sha256(csrf), scopeType, scopeId,
    createdAt: now, expiresAt: now + 15 * 60 * 1000, sourceIpPrefixHash: sourceIpHash(config, request.ip),
  }).run();
  reply.setCookie(capabilityCookie(config), token, cookieOptions(config, 15 * 60));
  reply.setCookie(capabilityCsrfHintCookie(config), csrf, cookieOptions(config, 15 * 60));
  return { csrfToken: csrf, expiresInSeconds: 15 * 60 };
}

export function clearCapabilityCookie(config: AppConfig, reply: FastifyReply): void {
  reply.clearCookie(capabilityCookie(config), cookieOptions(config, 0));
  reply.clearCookie(capabilityCsrfHintCookie(config), cookieOptions(config, 0));
}

export function capabilityCsrfFromRequest(config: AppConfig, request: FastifyRequest): string {
  return request.cookies[capabilityCsrfHintCookie(config)] ?? "";
}

export function capabilityGuard(scopeType: "download_share" | "upload_request", mutation = false) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const config = request.server.appConfig;
    const token = request.cookies[capabilityCookie(config)];
    const now = Date.now();
    const row = token ? request.server.database.orm.select().from(capabilitySessions).where(and(
      eq(capabilitySessions.tokenHash, sha256(token)), eq(capabilitySessions.scopeType, scopeType), gt(capabilitySessions.expiresAt, now),
    )).get() : undefined;
    if (!row || row.sourceIpPrefixHash !== sourceIpHash(config, request.ip) || (row.scopeType !== "download_share" && row.scopeType !== "upload_request")) {
      clearCapabilityCookie(config, reply);
      await sendError(reply, 403, "invalid_capability_session", "This link session is not available.");
      return;
    }
    request.capabilitySession = { id: row.id, csrfHash: row.csrfHash, scopeType: row.scopeType, scopeId: row.scopeId };
    if (mutation) {
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string" || !constantTimeEqual(sha256(csrf), row.csrfHash)) {
        await sendError(reply, 403, "invalid_csrf", "The request could not be verified.");
      }
    }
  };
}

export function revokeAllSessions(database: AppDatabase, now = Date.now()): void {
  database.orm.update(sessions).set({ revokedAt: now }).where(isNull(sessions.revokedAt)).run();
}

export function requestNetworkContext(config: AppConfig, request: FastifyRequest) {
  return { ipHash: sourceIpHash(config, request.ip), ipPrefix: ipPrefix(request.ip) };
}
