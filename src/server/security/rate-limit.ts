import type { AppDatabase } from "../db.js";
import type { AppConfig } from "../config.js";
import { hmac } from "./primitives.js";

export interface RatePolicy {
  bucket: string;
  key: string;
  limit: number;
  windowMs: number;
  escalationSeconds?: readonly number[];
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

type RateRow = { window_started_at: number; attempts: number; consecutive_failures: number; blocked_until: number | null };

function keyHash(config: AppConfig, policy: Pick<RatePolicy, "bucket" | "key">): string {
  return hmac(config, "rate-limit", `${policy.bucket}:${policy.key}`);
}

export function checkRateLimit(database: AppDatabase, config: AppConfig, policy: Pick<RatePolicy, "bucket" | "key">, now = Date.now()): RateDecision {
  const current = database.sqlite.prepare("SELECT blocked_until FROM rate_limits WHERE key_hash = ?").get(keyHash(config, policy)) as Pick<RateRow, "blocked_until"> | undefined;
  if (current?.blocked_until && current.blocked_until > now) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.blocked_until - now) / 1000)) };
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Records only a failed authentication attempt. The attempt that reaches the limit is rejected normally; subsequent attempts receive the lockout. */
export function recordRateLimitFailure(database: AppDatabase, config: AppConfig, policy: RatePolicy, now = Date.now()): RateDecision {
  const hash = keyHash(config, policy);
  return database.sqlite.transaction(() => {
    const current = database.sqlite.prepare("SELECT * FROM rate_limits WHERE key_hash = ?").get(hash) as RateRow | undefined;
    if (current?.blocked_until && current.blocked_until > now) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.blocked_until - now) / 1000)) };
    const resetWindow = !current || now - current.window_started_at >= policy.windowMs;
    const attempts = resetWindow ? 1 : current.attempts + 1;
    const failures = (current?.consecutive_failures ?? 0) + 1;
    let blockedUntil: number | null = null;
    if (attempts >= policy.limit) {
      const schedule = policy.escalationSeconds ?? [Math.ceil(policy.windowMs / 1000)];
      const series = Math.max(0, failures - policy.limit);
      blockedUntil = now + schedule[Math.min(series, schedule.length - 1)]! * 1000;
    }
    database.sqlite.prepare(`
      INSERT INTO rate_limits (key_hash, bucket, window_started_at, attempts, consecutive_failures, blocked_until, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key_hash) DO UPDATE SET window_started_at=excluded.window_started_at, attempts=excluded.attempts,
      consecutive_failures=excluded.consecutive_failures, blocked_until=excluded.blocked_until, updated_at=excluded.updated_at
    `).run(hash, policy.bucket, resetWindow ? now : current?.window_started_at ?? now, attempts, failures, blockedUntil, now);
    return blockedUntil ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) } : { allowed: true, retryAfterSeconds: 0 };
  })();
}

export function consumeRateLimit(database: AppDatabase, config: AppConfig, policy: RatePolicy, now = Date.now()): RateDecision {
  const hash = keyHash(config, policy);
  const transaction = database.sqlite.transaction(() => {
    const current = database.sqlite.prepare("SELECT * FROM rate_limits WHERE key_hash = ?").get(hash) as
      | { window_started_at: number; attempts: number; consecutive_failures: number; blocked_until: number | null }
      | undefined;
    if (current?.blocked_until && current.blocked_until > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.blocked_until - now) / 1000)) };
    }
    const resetWindow = !current || now - current.window_started_at >= policy.windowMs;
    const attempts = resetWindow ? 1 : current.attempts + 1;
    const failures = (current?.consecutive_failures ?? 0) + 1;
    let blockedUntil: number | null = null;
    if (attempts > policy.limit) {
      const schedule = policy.escalationSeconds ?? [Math.ceil(policy.windowMs / 1000)];
      blockedUntil = now + schedule[Math.min(failures - 1, schedule.length - 1)]! * 1000;
    }
    database.sqlite.prepare(`
      INSERT INTO rate_limits (key_hash, bucket, window_started_at, attempts, consecutive_failures, blocked_until, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key_hash) DO UPDATE SET window_started_at=excluded.window_started_at, attempts=excluded.attempts,
      consecutive_failures=excluded.consecutive_failures, blocked_until=excluded.blocked_until, updated_at=excluded.updated_at
    `).run(hash, policy.bucket, resetWindow ? now : current?.window_started_at ?? now, attempts, failures, blockedUntil, now);
    return blockedUntil ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) } : { allowed: true, retryAfterSeconds: 0 };
  });
  return transaction();
}

export function resetRateLimit(database: AppDatabase, config: AppConfig, bucket: string, key: string): void {
  database.sqlite.prepare("DELETE FROM rate_limits WHERE key_hash = ?").run(hmac(config, "rate-limit", `${bucket}:${key}`));
}
