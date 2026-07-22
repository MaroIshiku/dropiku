import { randomUUID } from "node:crypto";
import { desc, lt } from "drizzle-orm";
import type { AppDatabase } from "../db.js";
import { auditEvents } from "../schema.js";

const sensitivePattern = /authorization|cookie|secret|token|totp|recovery|master|password|query|user.?agent|raw.?ip/iu;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sensitivePattern.test(key) ? "[REDACTED]" : redact(entry)]));
  }
  return typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

export function writeAudit(
  database: AppDatabase,
  eventType: string,
  options: { severity?: "info" | "warn" | "error"; actorType?: string; actorReference?: string; sourceIpHash?: string; metadata?: unknown } = {},
): void {
  database.orm.insert(auditEvents).values({
    id: randomUUID(),
    eventType,
    severity: options.severity ?? "info",
    createdAt: Date.now(),
    actorType: options.actorType ?? "system",
    actorReference: options.actorReference ?? null,
    sourceIpHash: options.sourceIpHash ?? null,
    metadataJsonRedacted: JSON.stringify(redact(options.metadata ?? {})),
  }).run();
}

export function listAudit(database: AppDatabase, limit = 100) {
  return database.orm.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(Math.min(limit, 250)).all();
}

export function purgeOldAudit(database: AppDatabase, now = Date.now()): number {
  return database.orm.delete(auditEvents).where(lt(auditEvents.createdAt, now - 30 * 24 * 60 * 60 * 1000)).run().changes;
}
