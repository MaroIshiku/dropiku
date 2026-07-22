import { rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { capabilitySessions, downloadShares, files, rateLimits, sessions, submissions, uploadRequests } from "./schema.js";
import { purgeOldAudit, writeAudit } from "./security/audit.js";

export async function runCleanup(database: AppDatabase, config: AppConfig, logger?: FastifyBaseLogger, now = Date.now()): Promise<void> {
  database.orm.update(downloadShares).set({ revokedAt: now }).where(and(isNull(downloadShares.revokedAt), lt(downloadShares.expiresAt, now))).run();
  database.orm.update(uploadRequests).set({ revokedAt: now }).where(and(isNull(uploadRequests.revokedAt), lt(uploadRequests.expiresAt, now))).run();
  database.orm.delete(capabilitySessions).where(lt(capabilitySessions.expiresAt, now)).run();
  database.orm.delete(sessions).where(or(lt(sessions.absoluteExpiresAt, now), lt(sessions.expiresAt, now))).run();
  database.orm.delete(rateLimits).where(lt(rateLimits.updatedAt, now - 7 * 24 * 60 * 60 * 1000)).run();

  const abandoned = database.orm.select().from(submissions).where(and(eq(submissions.state, "pending"), lt(submissions.createdAt, now - 60 * 60 * 1000))).all();
  for (const submission of abandoned) {
    database.sqlite.transaction(() => {
      database.orm.update(files).set({ deletionState: "deleting", expiresAt: now }).where(eq(files.submissionId, submission.id)).run();
      database.orm.update(uploadRequests).set({ submissionCount: Math.max(0, (database.orm.select({ count: uploadRequests.submissionCount }).from(uploadRequests).where(eq(uploadRequests.id, submission.uploadRequestId)).get()?.count ?? 1) - 1) }).where(eq(uploadRequests.id, submission.uploadRequestId)).run();
      database.orm.update(submissions).set({ state: "abandoned" }).where(eq(submissions.id, submission.id)).run();
    })();
  }

  database.orm.update(files).set({ deletionState: "deleting" }).where(and(eq(files.deletionState, "active"), sqlNotNullExpired(now))).run();
  const deleting = database.orm.select().from(files).where(eq(files.deletionState, "deleting")).all();
  for (const file of deleting) {
    try {
      await rm(join(config.filesDir, file.storageKey), { force: true });
      database.orm.delete(files).where(eq(files.id, file.id)).run();
      writeAudit(database, "file_expired_deleted", { actorType: "system", actorReference: file.id, metadata: { sizeBytes: file.sizeBytes } });
    } catch (error) {
      logger?.warn({ err: error, fileId: file.id }, "File cleanup failed; it will be retried.");
    }
  }

  try {
    const entries = await readdir(config.temporaryDir, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const path = join(config.temporaryDir, entry.name);
      const info = await import("node:fs/promises").then(({ stat }) => stat(path));
      if (info.mtimeMs < now - 60 * 60 * 1000) await rm(path, { force: true });
    }));
  } catch (error) {
    logger?.warn({ err: error }, "Temporary upload cleanup failed.");
  }
  purgeOldAudit(database, now);
}

function sqlNotNullExpired(now: number) {
  return and(isNull(files.pinnedAt), lt(files.expiresAt, now))!;
}

export function startCleanupWorker(database: AppDatabase, config: AppConfig, logger: FastifyBaseLogger): () => void {
  void runCleanup(database, config, logger).catch((error: unknown) => logger.error({ err: error }, "Startup cleanup failed."));
  const timer = setInterval(() => void runCleanup(database, config, logger).catch((error: unknown) => logger.error({ err: error }, "Scheduled cleanup failed.")), 5 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
