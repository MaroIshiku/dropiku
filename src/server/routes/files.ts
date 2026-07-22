import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { downloadShareFiles, downloadShares, files } from "../schema.js";
import { calculateExpiry, discardStaged, ingestFile, openStoredFile, safeContentDisposition, Semaphore, UploadLimitError } from "../storage.js";
import { requireOwner, requireOwnerCsrf } from "../security/sessions.js";
import { writeAudit } from "../security/audit.js";
import { errorSchema, parsePositiveInt, sendError } from "../http.js";
import { sourceIpHash } from "../security/primitives.js";

const fileResponse = {
  type: "object", required: ["id", "displayName", "sizeBytes", "sha256", "detectedMime", "createdAt", "uploadCompletedAt", "pinned", "scanState", "ownerDownloadCount", "publicDownloadCount", "activeShareCount", "uploadSourceType"],
  properties: {
    id: { type: "string" }, displayName: { type: "string" }, sizeBytes: { type: "integer" }, sha256: { type: "string" }, clientMime: { type: ["string", "null"] },
    detectedMime: { type: "string" }, createdAt: { type: "integer" }, uploadCompletedAt: { type: "integer" }, expiresAt: { type: ["integer", "null"] },
    pinnedAt: { type: ["integer", "null"] }, pinned: { type: "boolean" }, scanState: { type: "string" }, scanDetailSafe: { type: ["string", "null"] },
    ownerDownloadCount: { type: "integer" }, publicDownloadCount: { type: "integer" }, activeShareCount: { type: "integer" }, uploadSourceType: { type: "string" }, submissionId: { type: ["string", "null"] },
  },
} as const;

function serializeFile(row: Record<string, unknown>) {
  return { ...row, pinned: row.pinnedAt !== null };
}

function totalStoredBytes(app: FastifyInstance): number {
  const row = app.database.sqlite.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files WHERE deletion_state = 'active'").get() as { total: number };
  return row.total;
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  const uploadSlots = new Semaphore(app.appConfig.maxConcurrentUploads);
  const downloadSlots = new Semaphore(app.appConfig.maxConcurrentDownloads);

  app.get<{ Querystring: { search?: string; sort?: string; filter?: string; limit?: string } }>("/api/files", {
    preHandler: requireOwner,
    schema: { tags: ["Files"], querystring: { type: "object", additionalProperties: false, properties: { search: { type: "string", maxLength: 255 }, sort: { enum: ["newest", "oldest", "name", "size_desc", "expires_soon"] }, filter: { enum: ["all", "pinned", "expiring", "shared", "uploaded_by_request"] }, limit: { type: "string", pattern: "^[0-9]+$" } } }, response: { 200: { type: "object", required: ["files", "total", "storageBytes", "storageLimitBytes"], properties: { files: { type: "array", items: fileResponse }, total: { type: "integer" }, storageBytes: { type: "integer" }, storageLimitBytes: { type: "integer" } } }, 401: errorSchema } },
  }, async (request) => {
    const search = request.query.search?.trim();
    const sort = request.query.sort ?? "newest";
    const filter = request.query.filter ?? "all";
    const clauses = [eq(files.deletionState, "active")];
    if (search) clauses.push(or(like(files.displayName, `%${search.replace(/[%_]/gu, "\\$&")}%`), like(files.sha256, `${search}%`))!);
    if (filter === "pinned") clauses.push(sql`${files.pinnedAt} IS NOT NULL`);
    if (filter === "expiring") clauses.push(and(sql`${files.expiresAt} IS NOT NULL`, sql`${files.expiresAt} < ${Date.now() + 24 * 60 * 60 * 1000}`)!);
    if (filter === "uploaded_by_request") clauses.push(eq(files.uploadSourceType, "upload_request"));
    if (filter === "shared") clauses.push(sql`EXISTS (SELECT 1 FROM download_share_files dsf JOIN download_shares ds ON ds.id = dsf.share_id WHERE dsf.file_id = files.id AND ds.revoked_at IS NULL AND ds.expires_at > ${Date.now()})`);
    const ordering = sort === "oldest" ? asc(files.createdAt) : sort === "name" ? asc(files.displayName) : sort === "size_desc" ? desc(files.sizeBytes) : sort === "expires_soon" ? asc(files.expiresAt) : desc(files.createdAt);
    const rows = app.database.orm.select({
      id: files.id, displayName: files.displayName, sizeBytes: files.sizeBytes, sha256: files.sha256, clientMime: files.clientMime,
      detectedMime: files.detectedMime, createdAt: files.createdAt, uploadCompletedAt: files.uploadCompletedAt, expiresAt: files.expiresAt,
      pinnedAt: files.pinnedAt, scanState: files.scanState, scanDetailSafe: files.scanDetailSafe, ownerDownloadCount: files.ownerDownloadCount,
      publicDownloadCount: files.publicDownloadCount, uploadSourceType: files.uploadSourceType, submissionId: files.submissionId,
      activeShareCount: sql<number>`(SELECT COUNT(*) FROM download_share_files dsf JOIN download_shares ds ON ds.id = dsf.share_id WHERE dsf.file_id = files.id AND ds.revoked_at IS NULL AND ds.expires_at > ${Date.now()})`,
    }).from(files).where(and(...clauses)).orderBy(ordering).limit(parsePositiveInt(request.query.limit, 200, 500)).all();
    return { files: rows.map((row) => serializeFile(row)), total: rows.length, storageBytes: totalStoredBytes(app), storageLimitBytes: app.appConfig.maxStorageBytes };
  });

  app.post<{ Querystring: { expiresIn?: string; pinned?: string } }>("/api/files/upload", {
    preHandler: requireOwnerCsrf,
    schema: { tags: ["Files"], consumes: ["multipart/form-data"], querystring: { type: "object", additionalProperties: false, properties: { expiresIn: { type: "string", pattern: "^[0-9]+$" }, pinned: { enum: ["true", "false"] } } }, response: { 201: { type: "object", required: ["files"], properties: { files: { type: "array", items: fileResponse } } }, 400: errorSchema, 401: errorSchema, 403: errorSchema, 413: errorSchema, 507: errorSchema } },
  }, async (request, reply) => {
    if (!request.isMultipart()) return sendError(reply, 400, "multipart_required", "Upload files as multipart/form-data.");
    if (totalStoredBytes(app) >= app.appConfig.maxStorageBytes * 0.98) return sendError(reply, 507, "storage_full", "Storage is too full to accept uploads.");
    const release = await uploadSlots.acquire();
    const created: Array<Record<string, unknown>> = [];
    try {
      const pinned = request.query.pinned === "true";
      const expirySeconds = parsePositiveInt(request.query.expiresIn, 24 * 60 * 60, 7 * 24 * 60 * 60);
      for await (const part of request.parts({ limits: { fileSize: app.appConfig.absoluteMaxFileBytes, files: 100, fields: 20, parts: 120 } })) {
        if (part.type !== "file") continue;
        const staged = await ingestFile(app.appConfig, part.file, { filename: part.filename, clientMime: part.mimetype, maximumBytes: app.appConfig.defaultMaxFileBytes });
        if (totalStoredBytes(app) + staged.sizeBytes > app.appConfig.maxStorageBytes) {
          await discardStaged(staged);
          throw new UploadLimitError("The configured storage quota would be exceeded.");
        }
        const now = Date.now();
        const row = {
          id: randomUUID(), displayName: staged.displayName, storageKey: staged.storageKey, sizeBytes: staged.sizeBytes, sha256: staged.sha256,
          clientMime: staged.clientMime, detectedMime: staged.detectedMime, uploadSourceType: "owner", uploadRequestId: null, submissionId: null,
          createdAt: now, uploadCompletedAt: now, expiresAt: pinned ? null : calculateExpiry(expirySeconds, now), pinnedAt: pinned ? now : null,
          scanState: staged.scanState, scanDetailSafe: staged.scanDetailSafe, deletionState: "active", ownerDownloadCount: 0, publicDownloadCount: 0,
        };
        try { app.database.orm.insert(files).values(row).run(); } catch (error) { await discardStaged(staged); throw error; }
        writeAudit(app.database, "file_uploaded", { actorType: "owner", actorReference: row.id, sourceIpHash: sourceIpHash(app.appConfig, request.ip), metadata: { sizeBytes: row.sizeBytes, source: "owner" } });
        created.push(serializeFile({ ...row, activeShareCount: 0 }));
      }
      if (!created.length) return sendError(reply, 400, "file_required", "Choose at least one file.");
      return reply.code(201).send({ files: created });
    } catch (error) {
      if (error instanceof UploadLimitError || (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return sendError(reply, 413, "upload_too_large", error instanceof Error ? error.message : "The upload is too large.");
      throw error;
    } finally {
      release();
    }
  });

  app.get<{ Params: { fileId: string } }>("/api/files/:fileId", { preHandler: requireOwner, schema: { tags: ["Files"], params: { type: "object", required: ["fileId"], properties: { fileId: { type: "string", minLength: 1, maxLength: 64 } } }, response: { 200: fileResponse, 401: errorSchema, 404: errorSchema } } }, async (request, reply) => {
    const row = app.database.orm.select().from(files).where(and(eq(files.id, request.params.fileId), eq(files.deletionState, "active"))).get();
    return row ? serializeFile({ ...row, activeShareCount: app.database.orm.select().from(downloadShareFiles).where(eq(downloadShareFiles.fileId, row.id)).all().length }) : sendError(reply, 404, "not_found", "The file was not found.");
  });

  app.get<{ Params: { fileId: string } }>("/api/files/:fileId/download", { preHandler: requireOwner, schema: { tags: ["Files"], params: { type: "object", required: ["fileId"], properties: { fileId: { type: "string" } } }, response: { 401: errorSchema, 404: errorSchema, 409: errorSchema } } }, async (request, reply) => {
    const row = app.database.orm.select().from(files).where(and(eq(files.id, request.params.fileId), eq(files.deletionState, "active"))).get();
    if (!row) return sendError(reply, 404, "not_found", "The file was not found.");
    if (row.scanState === "infected" || row.scanState === "scan_error") return sendError(reply, 409, "file_quarantined", "The file is quarantined and cannot be downloaded.");
    const release = await downloadSlots.acquire();
    const stream = openStoredFile(app.appConfig, row.storageKey);
    stream.once("close", release);
    app.database.orm.update(files).set({ ownerDownloadCount: sql`${files.ownerDownloadCount} + 1` }).where(eq(files.id, row.id)).run();
    writeAudit(app.database, "file_downloaded_owner", { actorType: "owner", actorReference: row.id, sourceIpHash: sourceIpHash(app.appConfig, request.ip) });
    reply.header("Content-Type", "application/octet-stream").header("Content-Disposition", safeContentDisposition(row.displayName)).header("Content-Length", row.sizeBytes).header("Cache-Control", "no-store");
    return reply.send(stream);
  });

  app.patch<{ Params: { fileId: string }; Body: { displayName?: string; pinned?: boolean; expiresInSeconds?: number } }>("/api/files/:fileId", {
    preHandler: requireOwnerCsrf,
    schema: { tags: ["Files"], params: { type: "object", required: ["fileId"], properties: { fileId: { type: "string" } } }, body: { type: "object", additionalProperties: false, minProperties: 1, properties: { displayName: { type: "string", minLength: 1, maxLength: 255 }, pinned: { type: "boolean" }, expiresInSeconds: { type: "integer", minimum: 900, maximum: 604800 } } }, response: { 200: fileResponse, 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema } },
  }, async (request, reply) => {
    const current = app.database.orm.select().from(files).where(and(eq(files.id, request.params.fileId), eq(files.deletionState, "active"))).get();
    if (!current) return sendError(reply, 404, "not_found", "The file was not found.");
    const now = Date.now();
    const updates: Partial<typeof files.$inferInsert> = {};
    if (request.body.displayName !== undefined) updates.displayName = request.body.displayName.normalize("NFKC").trim();
    if (request.body.pinned === true) { updates.pinnedAt = now; updates.expiresAt = null; }
    if (request.body.pinned === false) { updates.pinnedAt = null; updates.expiresAt = calculateExpiry(request.body.expiresInSeconds ?? 24 * 60 * 60, now); }
    if (request.body.expiresInSeconds !== undefined && request.body.pinned !== true) updates.expiresAt = calculateExpiry(request.body.expiresInSeconds, current.uploadCompletedAt);
    app.database.orm.update(files).set(updates).where(eq(files.id, current.id)).run();
    const updated = app.database.orm.select().from(files).where(eq(files.id, current.id)).get()!;
    writeAudit(app.database, updated.pinnedAt ? "file_pinned" : "file_updated", { actorType: "owner", actorReference: current.id });
    return serializeFile({ ...updated, activeShareCount: 0 });
  });

  app.delete<{ Params: { fileId: string } }>("/api/files/:fileId", { preHandler: requireOwnerCsrf, schema: { tags: ["Files"], params: { type: "object", required: ["fileId"], properties: { fileId: { type: "string" } } }, response: { 204: { type: "null" }, 401: errorSchema, 403: errorSchema, 404: errorSchema } } }, async (request, reply) => {
    const now = Date.now();
    const transaction = app.database.sqlite.transaction(() => {
      const row = app.database.orm.select().from(files).where(and(eq(files.id, request.params.fileId), eq(files.deletionState, "active"))).get();
      if (!row) return null;
      app.database.orm.update(files).set({ deletionState: "deleting", expiresAt: now }).where(eq(files.id, row.id)).run();
      const sharesForFile = app.database.orm.select({ shareId: downloadShareFiles.shareId }).from(downloadShareFiles).where(eq(downloadShareFiles.fileId, row.id)).all();
      for (const share of sharesForFile) app.database.orm.update(downloadShares).set({ revokedAt: now }).where(and(eq(downloadShares.id, share.shareId), isNull(downloadShares.revokedAt))).run();
      return row;
    });
    const row = transaction();
    if (!row) return sendError(reply, 404, "not_found", "The file was not found.");
    writeAudit(app.database, "file_deleted", { actorType: "owner", actorReference: row.id });
    return reply.code(204).send();
  });
}
