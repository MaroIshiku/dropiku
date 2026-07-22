import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { downloadShareFiles, downloadShares, files } from "../schema.js";
import { calculateExpiry, openStoredFile, safeContentDisposition, Semaphore } from "../storage.js";
import { requireOwner, requireOwnerCsrf, capabilityGuard, capabilityCsrfFromRequest, createCapabilitySession } from "../security/sessions.js";
import { constantTimeEqual, hmac, randomToken, sourceIpHash } from "../security/primitives.js";
import { consumeRateLimit } from "../security/rate-limit.js";
import { writeAudit } from "../security/audit.js";
import { errorSchema, sendError } from "../http.js";

const unavailableMessage = "This link is not available.";

async function uniformCapabilityDelay(started: number): Promise<void> {
  const wait = 220 - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  const downloadSlots = new Semaphore(app.appConfig.maxConcurrentDownloads);

  app.post<{ Body: { fileIds: string[]; expiresInSeconds: number; maxDownloads?: number | null; behavior?: "show_landing_page" | "start_download_after_resolution"; label?: string | null } }>("/api/download-shares", {
    preHandler: requireOwnerCsrf,
    schema: {
      tags: ["Download shares"], body: { type: "object", additionalProperties: false, required: ["fileIds", "expiresInSeconds"], properties: { fileIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string" } }, expiresInSeconds: { type: "integer", minimum: 900, maximum: 604800 }, maxDownloads: { type: ["integer", "null"], minimum: 1, maximum: 10000 }, behavior: { enum: ["show_landing_page", "start_download_after_resolution"] }, label: { type: ["string", "null"], maxLength: 100 } } },
      response: { 201: { type: "object", required: ["id", "link", "expiresAt"], properties: { id: { type: "string" }, link: { type: "string" }, expiresAt: { type: "integer" } } }, 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema },
    },
  }, async (request, reply) => {
    const selected = app.database.orm.select({ id: files.id }).from(files).where(and(inArray(files.id, request.body.fileIds), eq(files.deletionState, "active"), sql`${files.scanState} NOT IN ('infected', 'scan_error')`)).all();
    if (selected.length !== request.body.fileIds.length) return sendError(reply, 404, "file_not_available", "One or more selected files are not available for sharing.");
    const id = randomUUID();
    const publicId = randomToken(16);
    const secret = randomToken(32);
    const expiresAt = calculateExpiry(request.body.expiresInSeconds);
    app.database.sqlite.transaction(() => {
      app.database.orm.insert(downloadShares).values({
        id, publicId, secretHash: hmac(app.appConfig, "download-share", secret), label: request.body.label?.trim() || null,
        createdAt: Date.now(), expiresAt, maxDownloads: request.body.maxDownloads ?? null, downloadCount: 0, revokedAt: null,
        behavior: request.body.behavior ?? "show_landing_page",
      }).run();
      for (const fileId of request.body.fileIds) app.database.orm.insert(downloadShareFiles).values({ shareId: id, fileId }).run();
    })();
    writeAudit(app.database, "share_created", { actorType: "owner", actorReference: id, metadata: { fileCount: request.body.fileIds.length, expiresAt } });
    return reply.code(201).send({ id, link: `${app.appConfig.appBaseUrl}/s/${publicId}#${secret}`, expiresAt });
  });

  app.get("/api/download-shares", { preHandler: requireOwner, schema: { tags: ["Download shares"], response: { 200: { type: "object", required: ["shares"], properties: { shares: { type: "array", items: { type: "object", additionalProperties: true } } } }, 401: errorSchema } } }, async () => {
    const rows = app.database.orm.select().from(downloadShares).orderBy(desc(downloadShares.createdAt)).limit(250).all();
    return { shares: rows.map(({ secretHash, ...share }) => { void secretHash; return { ...share, fileCount: app.database.orm.select().from(downloadShareFiles).where(eq(downloadShareFiles.shareId, share.id)).all().length, active: !share.revokedAt && share.expiresAt > Date.now() && (share.maxDownloads === null || share.downloadCount < share.maxDownloads) }; }) };
  });

  app.delete<{ Params: { shareId: string } }>("/api/download-shares/:shareId", { preHandler: requireOwnerCsrf, schema: { tags: ["Download shares"], params: { type: "object", required: ["shareId"], properties: { shareId: { type: "string" } } }, response: { 204: { type: "null" }, 401: errorSchema, 403: errorSchema, 404: errorSchema } } }, async (request, reply) => {
    const result = app.database.orm.update(downloadShares).set({ revokedAt: Date.now() }).where(and(eq(downloadShares.id, request.params.shareId), isNull(downloadShares.revokedAt))).run();
    if (!result.changes) return sendError(reply, 404, "not_found", "The share was not found.");
    writeAudit(app.database, "share_revoked", { actorType: "owner", actorReference: request.params.shareId });
    return reply.code(204).send();
  });

  app.post<{ Body: { publicId: string; secret: string } }>("/api/public/download-shares/resolve", {
    schema: { tags: ["Public download"], body: { type: "object", additionalProperties: false, required: ["publicId", "secret"], properties: { publicId: { type: "string", minLength: 20, maxLength: 32 }, secret: { type: "string", minLength: 40, maxLength: 64 } } }, response: { 200: { type: "object", required: ["resolved", "csrfToken", "expiresInSeconds"], properties: { resolved: { type: "boolean" }, csrfToken: { type: "string" }, expiresInSeconds: { type: "integer" } } }, 404: errorSchema, 429: errorSchema } },
  }, async (request, reply) => {
    const started = Date.now();
    const ipHash = sourceIpHash(app.appConfig, request.ip);
    const decision = consumeRateLimit(app.database, app.appConfig, { bucket: "public-download-resolve", key: ipHash, limit: 30, windowMs: 15 * 60_000 });
    if (!decision.allowed) {
      reply.header("Retry-After", decision.retryAfterSeconds);
      await uniformCapabilityDelay(started);
      return sendError(reply, 429, "try_again_later", unavailableMessage);
    }
    const row = app.database.orm.select().from(downloadShares).where(eq(downloadShares.publicId, request.body.publicId)).get();
    const expected = hmac(app.appConfig, "download-share", request.body.secret);
    const valid = row && !row.revokedAt && row.expiresAt > Date.now() && (row.maxDownloads === null || row.downloadCount < row.maxDownloads) && constantTimeEqual(row.secretHash, expected);
    await uniformCapabilityDelay(started);
    if (!valid || !row) return sendError(reply, 404, "link_not_available", unavailableMessage);
    return { resolved: true, ...createCapabilitySession(app.database, app.appConfig, request, reply, "download_share", row.id) };
  });

  app.get("/api/public/download-shares/session/info", {
    preHandler: capabilityGuard("download_share"),
    schema: {
      tags: ["Public download"],
      response: {
        200: { type: "object", additionalProperties: true },
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const scopeId = request.capabilitySession!.scopeId;
    const share = app.database.orm.select().from(downloadShares).where(and(eq(downloadShares.id, scopeId), isNull(downloadShares.revokedAt), gt(downloadShares.expiresAt, Date.now()))).get();
    if (!share || (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads)) return sendError(reply, 404, "link_not_available", unavailableMessage);
    const shared = app.database.orm.select({ ref: files.id, displayName: files.displayName, sizeBytes: files.sizeBytes }).from(downloadShareFiles).innerJoin(files, eq(files.id, downloadShareFiles.fileId)).where(and(eq(downloadShareFiles.shareId, share.id), eq(files.deletionState, "active"))).all();
    return { label: share.label, expiresAt: share.expiresAt, behavior: share.behavior, files: shared, csrfToken: capabilityCsrfFromRequest(app.appConfig, request) };
  });

  app.get<{ Params: { fileRef: string } }>("/api/public/download-shares/session/download/:fileRef", { preHandler: capabilityGuard("download_share"), schema: { tags: ["Public download"], params: { type: "object", required: ["fileRef"], properties: { fileRef: { type: "string" } } }, response: { 403: errorSchema, 404: errorSchema, 409: errorSchema } } }, async (request, reply) => {
    const shareId = request.capabilitySession!.scopeId;
    const reservation = app.database.sqlite.transaction(() => {
      const share = app.database.sqlite.prepare("SELECT * FROM download_shares WHERE id = ? AND revoked_at IS NULL AND expires_at > ?").get(shareId, Date.now()) as { max_downloads: number | null; download_count: number } | undefined;
      if (!share || (share.max_downloads !== null && share.download_count >= share.max_downloads)) return null;
      const file = app.database.sqlite.prepare(`SELECT f.* FROM files f JOIN download_share_files dsf ON dsf.file_id=f.id WHERE dsf.share_id=? AND f.id=? AND f.deletion_state='active'`).get(shareId, request.params.fileRef) as { id: string; display_name: string; storage_key: string; size_bytes: number } | undefined;
      if (!file) return null;
      const update = app.database.sqlite.prepare("UPDATE download_shares SET download_count=download_count+1 WHERE id=? AND revoked_at IS NULL AND expires_at>? AND (max_downloads IS NULL OR download_count < max_downloads)").run(shareId, Date.now());
      return update.changes === 1 ? file : null;
    })();
    if (!reservation) return sendError(reply, 404, "link_not_available", unavailableMessage);
    const release = await downloadSlots.acquire();
    const stream = openStoredFile(app.appConfig, reservation.storage_key);
    let transferred = 0;
    let completed = false;
    stream.on("data", (chunk: string | Buffer) => { transferred += Buffer.byteLength(chunk); });
    stream.once("end", () => {
      completed = true;
      app.database.orm.update(files).set({ publicDownloadCount: sql`${files.publicDownloadCount} + 1` }).where(eq(files.id, reservation.id)).run();
      writeAudit(app.database, "file_downloaded_public", { actorType: "public_share", actorReference: shareId, sourceIpHash: sourceIpHash(app.appConfig, request.ip), metadata: { fileId: reservation.id } });
    });
    stream.once("close", () => {
      release();
      const minimum = Math.min(1_048_576, reservation.size_bytes);
      if (!completed || transferred < minimum) app.database.orm.update(downloadShares).set({ downloadCount: sql`MAX(0, ${downloadShares.downloadCount} - 1)` }).where(eq(downloadShares.id, shareId)).run();
    });
    reply.header("Content-Type", "application/octet-stream").header("Content-Disposition", safeContentDisposition(reservation.display_name)).header("Content-Length", reservation.size_bytes).header("Cache-Control", "no-store, private");
    return reply.send(stream);
  });
}
