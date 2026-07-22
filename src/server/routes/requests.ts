import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { files, submissions, uploadRequests } from "../schema.js";
import { calculateExpiry, discardStaged, extensionAllowed, ingestFile, Semaphore, UploadLimitError } from "../storage.js";
import { capabilityCsrfFromRequest, capabilityGuard, createCapabilitySession, requireOwner, requireOwnerCsrf } from "../security/sessions.js";
import { constantTimeEqual, hmac, randomToken, sourceIpHash } from "../security/primitives.js";
import { consumeRateLimit } from "../security/rate-limit.js";
import { writeAudit } from "../security/audit.js";
import { errorSchema, sendError } from "../http.js";

interface CreateUploadRequestBody {
  title: string;
  message?: string | null;
  expiresInSeconds: number;
  maxFilesPerSubmission: number;
  maxSubmissions?: number | null;
  maxFileSizeBytes: number;
  maxTotalBytesPerSubmission: number;
  maxTotalBytesAllSubmissions?: number | null;
  allowedExtensions?: string[] | null;
  deniedExtensions?: string[] | null;
  submitterNameMode?: "disabled" | "optional" | "required";
  submitterMessageMode?: "disabled" | "optional" | "required";
  notifyOwner?: boolean;
}

const unavailableMessage = "This link is not available.";

function parseList(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : null;
  } catch { return null; }
}

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  const uploadSlots = new Semaphore(app.appConfig.maxConcurrentUploads);

  app.post<{ Body: CreateUploadRequestBody }>("/api/upload-requests", {
    preHandler: requireOwnerCsrf,
    schema: {
      tags: ["Upload requests"], body: { type: "object", additionalProperties: false, required: ["title", "expiresInSeconds", "maxFilesPerSubmission", "maxFileSizeBytes", "maxTotalBytesPerSubmission"], properties: {
        title: { type: "string", minLength: 1, maxLength: 100 }, message: { type: ["string", "null"], maxLength: 500 }, expiresInSeconds: { type: "integer", minimum: 900, maximum: 604800 }, maxFilesPerSubmission: { type: "integer", minimum: 1, maximum: 100 }, maxSubmissions: { type: ["integer", "null"], minimum: 1, maximum: 10000 }, maxFileSizeBytes: { type: "integer", minimum: 1 }, maxTotalBytesPerSubmission: { type: "integer", minimum: 1 }, maxTotalBytesAllSubmissions: { type: ["integer", "null"], minimum: 1 }, allowedExtensions: { type: ["array", "null"], maxItems: 100, items: { type: "string", pattern: "^[A-Za-z0-9]{1,20}$" } }, deniedExtensions: { type: ["array", "null"], maxItems: 100, items: { type: "string", pattern: "^[A-Za-z0-9]{1,20}$" } }, submitterNameMode: { enum: ["disabled", "optional", "required"] }, submitterMessageMode: { enum: ["disabled", "optional", "required"] }, notifyOwner: { type: "boolean" },
      } },
      response: { 201: { type: "object", required: ["id", "link", "expiresAt"], properties: { id: { type: "string" }, link: { type: "string" }, expiresAt: { type: "integer" } } }, 400: errorSchema, 401: errorSchema, 403: errorSchema },
    },
  }, async (request, reply) => {
    const body = request.body;
    if (body.maxFileSizeBytes > app.appConfig.absoluteMaxFileBytes || body.maxTotalBytesPerSubmission < body.maxFileSizeBytes) return sendError(reply, 400, "invalid_limits", "Upload limits are inconsistent or exceed the server maximum.");
    const id = randomUUID();
    const publicId = randomToken(16);
    const secret = randomToken(32);
    const expiresAt = calculateExpiry(body.expiresInSeconds);
    app.database.orm.insert(uploadRequests).values({
      id, publicId, secretHash: hmac(app.appConfig, "upload-request", secret), title: body.title.trim(), message: body.message?.trim() || null,
      createdAt: Date.now(), expiresAt, maxFilesPerSubmission: body.maxFilesPerSubmission, maxSubmissions: body.maxSubmissions ?? null,
      maxFileSizeBytes: body.maxFileSizeBytes, maxTotalBytesPerSubmission: body.maxTotalBytesPerSubmission, maxTotalBytesAllSubmissions: body.maxTotalBytesAllSubmissions ?? null,
      allowedExtensionsJson: body.allowedExtensions?.length ? JSON.stringify([...new Set(body.allowedExtensions.map((entry) => entry.toLowerCase()))]) : null,
      deniedExtensionsJson: body.deniedExtensions?.length ? JSON.stringify([...new Set(body.deniedExtensions.map((entry) => entry.toLowerCase()))]) : null,
      submitterNameMode: body.submitterNameMode ?? "disabled", submitterMessageMode: body.submitterMessageMode ?? "disabled", retainSeconds: 604800,
      notifyOwner: body.notifyOwner ?? true, revokedAt: null,
    }).run();
    writeAudit(app.database, "upload_request_created", { actorType: "owner", actorReference: id, metadata: { expiresAt, maxFiles: body.maxFilesPerSubmission } });
    return reply.code(201).send({ id, link: `${app.appConfig.appBaseUrl}/r/${publicId}#${secret}`, expiresAt });
  });

  app.get("/api/upload-requests", { preHandler: requireOwner, schema: { tags: ["Upload requests"], response: { 200: { type: "object", required: ["requests"], properties: { requests: { type: "array", items: { type: "object", additionalProperties: true } } } }, 401: errorSchema } } }, async () => {
    const rows = app.database.orm.select().from(uploadRequests).orderBy(desc(uploadRequests.createdAt)).limit(250).all();
    return { requests: rows.map(({ secretHash, ...row }) => { void secretHash; return { ...row, active: !row.revokedAt && row.expiresAt > Date.now() && (row.maxSubmissions === null || row.submissionCount < row.maxSubmissions) }; }) };
  });

  app.get<{ Params: { requestId: string } }>("/api/upload-requests/:requestId", { preHandler: requireOwner, schema: { tags: ["Upload requests"], params: { type: "object", required: ["requestId"], properties: { requestId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true }, 401: errorSchema, 404: errorSchema } } }, async (request, reply) => {
    const row = app.database.orm.select().from(uploadRequests).where(eq(uploadRequests.id, request.params.requestId)).get();
    if (!row) return sendError(reply, 404, "not_found", "The upload request was not found.");
    const submissionRows = app.database.orm.select().from(submissions).where(eq(submissions.uploadRequestId, row.id)).orderBy(desc(submissions.createdAt)).all();
    const grouped = submissionRows.map((submission) => ({ ...submission, files: app.database.orm.select({ id: files.id, displayName: files.displayName, sizeBytes: files.sizeBytes, scanState: files.scanState, pinnedAt: files.pinnedAt }).from(files).where(eq(files.submissionId, submission.id)).all() }));
    const { secretHash, ...safe } = row;
    void secretHash;
    return { ...safe, submissions: grouped };
  });

  app.delete<{ Params: { requestId: string } }>("/api/upload-requests/:requestId", { preHandler: requireOwnerCsrf, schema: { tags: ["Upload requests"], params: { type: "object", required: ["requestId"], properties: { requestId: { type: "string" } } }, response: { 204: { type: "null" }, 401: errorSchema, 403: errorSchema, 404: errorSchema } } }, async (request, reply) => {
    const result = app.database.orm.update(uploadRequests).set({ revokedAt: Date.now() }).where(and(eq(uploadRequests.id, request.params.requestId), isNull(uploadRequests.revokedAt))).run();
    if (!result.changes) return sendError(reply, 404, "not_found", "The upload request was not found.");
    writeAudit(app.database, "upload_request_revoked", { actorType: "owner", actorReference: request.params.requestId });
    return reply.code(204).send();
  });

  app.post<{ Body: { publicId: string; secret: string } }>("/api/public/upload-requests/resolve", { schema: { tags: ["Public upload"], body: { type: "object", additionalProperties: false, required: ["publicId", "secret"], properties: { publicId: { type: "string", minLength: 20, maxLength: 32 }, secret: { type: "string", minLength: 40, maxLength: 64 } } }, response: { 200: { type: "object", required: ["resolved", "csrfToken", "expiresInSeconds"], properties: { resolved: { type: "boolean" }, csrfToken: { type: "string" }, expiresInSeconds: { type: "integer" } } }, 404: errorSchema, 429: errorSchema } } }, async (request, reply) => {
    const ipHash = sourceIpHash(app.appConfig, request.ip);
    const decision = consumeRateLimit(app.database, app.appConfig, { bucket: "public-upload-resolve", key: ipHash, limit: 30, windowMs: 15 * 60_000 });
    if (!decision.allowed) { reply.header("Retry-After", decision.retryAfterSeconds); return sendError(reply, 429, "try_again_later", unavailableMessage); }
    const row = app.database.orm.select().from(uploadRequests).where(eq(uploadRequests.publicId, request.body.publicId)).get();
    const valid = row && !row.revokedAt && row.expiresAt > Date.now() && (row.maxSubmissions === null || row.submissionCount < row.maxSubmissions) && constantTimeEqual(row.secretHash, hmac(app.appConfig, "upload-request", request.body.secret));
    if (!valid || !row) return sendError(reply, 404, "link_not_available", unavailableMessage);
    return { resolved: true, ...createCapabilitySession(app.database, app.appConfig, request, reply, "upload_request", row.id) };
  });

  app.get("/api/public/upload-requests/session/info", { preHandler: capabilityGuard("upload_request"), schema: { tags: ["Public upload"], response: { 200: { type: "object", additionalProperties: true }, 403: errorSchema, 404: errorSchema } } }, async (request, reply) => {
    const row = app.database.orm.select().from(uploadRequests).where(and(eq(uploadRequests.id, request.capabilitySession!.scopeId), isNull(uploadRequests.revokedAt), gt(uploadRequests.expiresAt, Date.now()))).get();
    if (!row || (row.maxSubmissions !== null && row.submissionCount >= row.maxSubmissions)) return sendError(reply, 404, "link_not_available", unavailableMessage);
    return { title: row.title, message: row.message, expiresAt: row.expiresAt, maxFilesPerSubmission: row.maxFilesPerSubmission, maxFileSizeBytes: row.maxFileSizeBytes, maxTotalBytesPerSubmission: row.maxTotalBytesPerSubmission, allowedExtensions: parseList(row.allowedExtensionsJson), submitterNameMode: row.submitterNameMode, submitterMessageMode: row.submitterMessageMode, csrfToken: capabilityCsrfFromRequest(app.appConfig, request) };
  });

  app.post<{ Body: { submitterName?: string; submitterMessage?: string } }>("/api/public/upload-requests/session/submissions/init", { preHandler: capabilityGuard("upload_request", true), schema: { tags: ["Public upload"], body: { type: "object", additionalProperties: false, properties: { submitterName: { type: "string", maxLength: 100 }, submitterMessage: { type: "string", maxLength: 500 } } }, response: { 201: { type: "object", required: ["submissionRef"], properties: { submissionRef: { type: "string" } } }, 400: errorSchema, 403: errorSchema, 409: errorSchema } } }, async (request, reply) => {
    const requestId = request.capabilitySession!.scopeId;
    const uploadRequest = app.database.orm.select().from(uploadRequests).where(eq(uploadRequests.id, requestId)).get();
    if (!uploadRequest || (uploadRequest.submitterNameMode === "required" && !request.body.submitterName?.trim()) || (uploadRequest.submitterMessageMode === "required" && !request.body.submitterMessage?.trim())) return sendError(reply, 400, "required_fields_missing", "Complete the required sender fields.");
    const id = randomUUID();
    const publicReference = randomToken(9);
    const now = Date.now();
    const reserved = app.database.sqlite.transaction(() => {
      const update = app.database.sqlite.prepare("UPDATE upload_requests SET submission_count=submission_count+1 WHERE id=? AND revoked_at IS NULL AND expires_at>? AND (max_submissions IS NULL OR submission_count < max_submissions)").run(requestId, now);
      if (update.changes !== 1) return false;
      app.database.orm.insert(submissions).values({ id, uploadRequestId: requestId, publicReference, submitterName: uploadRequest.submitterNameMode === "disabled" ? null : request.body.submitterName?.trim() || null, submitterMessage: uploadRequest.submitterMessageMode === "disabled" ? null : request.body.submitterMessage?.trim() || null, sourceIpHash: sourceIpHash(app.appConfig, request.ip), createdAt: now, completedAt: null, fileCount: 0, totalBytes: 0, state: "pending" }).run();
      return true;
    })();
    return reserved ? reply.code(201).send({ submissionRef: publicReference }) : sendError(reply, 409, "submission_limit_reached", unavailableMessage);
  });

  app.post<{ Params: { submissionRef: string } }>("/api/public/upload-requests/session/submissions/:submissionRef/files", {
    preHandler: capabilityGuard("upload_request", true),
    schema: {
      tags: ["Public upload"],
      consumes: ["multipart/form-data"],
      params: { type: "object", required: ["submissionRef"], properties: { submissionRef: { type: "string" } } },
      response: {
        201: { type: "object", additionalProperties: true },
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
        413: errorSchema,
        507: errorSchema,
      },
    },
  }, async (request, reply) => {
    if (!request.isMultipart()) return sendError(reply, 400, "multipart_required", "Upload files as multipart/form-data.");
    const uploadRequest = app.database.orm.select().from(uploadRequests).where(eq(uploadRequests.id, request.capabilitySession!.scopeId)).get();
    const submission = app.database.orm.select().from(submissions).where(and(eq(submissions.publicReference, request.params.submissionRef), eq(submissions.uploadRequestId, request.capabilitySession!.scopeId), eq(submissions.state, "pending"))).get();
    if (!uploadRequest || !submission) return sendError(reply, 409, "submission_not_available", unavailableMessage);
    const release = await uploadSlots.acquire();
    const accepted: Array<{ displayName: string; sizeBytes: number }> = [];
    try {
      for await (const part of request.parts({ limits: { fileSize: uploadRequest.maxFileSizeBytes, files: uploadRequest.maxFilesPerSubmission, fields: 10, parts: uploadRequest.maxFilesPerSubmission + 10 } })) {
        if (part.type !== "file") continue;
        if (!extensionAllowed(part.filename, parseList(uploadRequest.allowedExtensionsJson), parseList(uploadRequest.deniedExtensionsJson))) throw new UploadLimitError("This file extension is not allowed.");
        const staged = await ingestFile(app.appConfig, part.file, { filename: part.filename, clientMime: part.mimetype, maximumBytes: uploadRequest.maxFileSizeBytes });
        const now = Date.now();
        const id = randomUUID();
        try {
          app.database.sqlite.transaction(() => {
            const subUpdate = app.database.sqlite.prepare("UPDATE submissions SET file_count=file_count+1,total_bytes=total_bytes+? WHERE id=? AND state='pending' AND file_count < ? AND total_bytes + ? <= ?").run(staged.sizeBytes, submission.id, uploadRequest.maxFilesPerSubmission, staged.sizeBytes, uploadRequest.maxTotalBytesPerSubmission);
            if (subUpdate.changes !== 1) throw new UploadLimitError("The submission file or byte limit was reached.");
            const reqUpdate = app.database.sqlite.prepare("UPDATE upload_requests SET accepted_total_bytes=accepted_total_bytes+? WHERE id=? AND revoked_at IS NULL AND expires_at>? AND (max_total_bytes_all_submissions IS NULL OR accepted_total_bytes + ? <= max_total_bytes_all_submissions)").run(staged.sizeBytes, uploadRequest.id, now, staged.sizeBytes);
            if (reqUpdate.changes !== 1) throw new UploadLimitError("The upload request byte limit was reached.");
            app.database.orm.insert(files).values({ id, displayName: staged.displayName, storageKey: staged.storageKey, sizeBytes: staged.sizeBytes, sha256: staged.sha256, clientMime: staged.clientMime, detectedMime: staged.detectedMime, uploadSourceType: "upload_request", uploadRequestId: uploadRequest.id, submissionId: submission.id, createdAt: now, uploadCompletedAt: now, expiresAt: calculateExpiry(uploadRequest.retainSeconds, now), pinnedAt: null, scanState: staged.scanState, scanDetailSafe: staged.scanDetailSafe, deletionState: "active", ownerDownloadCount: 0, publicDownloadCount: 0 }).run();
          })();
        } catch (error) { await discardStaged(staged); throw error; }
        accepted.push({ displayName: staged.displayName, sizeBytes: staged.sizeBytes });
      }
      if (!accepted.length) return sendError(reply, 400, "file_required", "Choose at least one file.");
      return reply.code(201).send({ accepted: true, files: accepted });
    } catch (error) {
      if (error instanceof UploadLimitError || (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return sendError(reply, 413, "upload_limit_reached", error instanceof Error ? error.message : "The upload exceeds its limit.");
      throw error;
    } finally { release(); }
  });

  app.post<{ Params: { submissionRef: string } }>("/api/public/upload-requests/session/submissions/:submissionRef/complete", { preHandler: capabilityGuard("upload_request", true), schema: { tags: ["Public upload"], params: { type: "object", required: ["submissionRef"], properties: { submissionRef: { type: "string" } } }, response: { 200: { type: "object", required: ["completed", "reference"], properties: { completed: { type: "boolean" }, reference: { type: "string" } } }, 403: errorSchema, 409: errorSchema } } }, async (request, reply) => {
    const now = Date.now();
    const result = app.database.sqlite.prepare("UPDATE submissions SET state='completed',completed_at=? WHERE public_reference=? AND upload_request_id=? AND state='pending' AND file_count > 0").run(now, request.params.submissionRef, request.capabilitySession!.scopeId);
    if (result.changes !== 1) return sendError(reply, 409, "submission_not_available", unavailableMessage);
    const submission = app.database.orm.select().from(submissions).where(eq(submissions.publicReference, request.params.submissionRef)).get()!;
    writeAudit(app.database, "submission_received", { actorType: "upload_request", actorReference: submission.uploadRequestId, sourceIpHash: submission.sourceIpHash, metadata: { reference: submission.publicReference, fileCount: submission.fileCount, totalBytes: submission.totalBytes } });
    return { completed: true, reference: submission.publicReference };
  });
}
