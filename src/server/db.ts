import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import type { AppConfig } from "./config.js";

export type AppDatabase = ReturnType<typeof createDatabase>;

const migrationSql = `
CREATE TABLE IF NOT EXISTS owner_config (
  singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1), encrypted_totp_secret TEXT NOT NULL,
  totp_digits INTEGER NOT NULL DEFAULT 10, totp_period_seconds INTEGER NOT NULL DEFAULT 30,
  totp_algorithm TEXT NOT NULL DEFAULT 'SHA1', last_accepted_totp_step INTEGER,
  setup_completed_at INTEGER NOT NULL, recovery_required_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY, argon2id_hash TEXT NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL,
  ip_prefix_hash TEXT NOT NULL, user_agent_hash TEXT NOT NULL, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL, client_mime TEXT, detected_mime TEXT NOT NULL, upload_source_type TEXT NOT NULL,
  upload_request_id TEXT, submission_id TEXT, created_at INTEGER NOT NULL, upload_completed_at INTEGER NOT NULL,
  expires_at INTEGER, pinned_at INTEGER, scan_state TEXT NOT NULL DEFAULT 'not_configured', scan_detail_safe TEXT,
  deletion_state TEXT NOT NULL DEFAULT 'active', owner_download_count INTEGER NOT NULL DEFAULT 0,
  public_download_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS files_expiry_idx ON files(expires_at);
CREATE INDEX IF NOT EXISTS files_submission_idx ON files(submission_id);
CREATE TABLE IF NOT EXISTS download_shares (
  id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, secret_hash TEXT NOT NULL, label TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, max_downloads INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER, behavior TEXT NOT NULL DEFAULT 'show_landing_page'
);
CREATE INDEX IF NOT EXISTS download_shares_expiry_idx ON download_shares(expires_at);
CREATE TABLE IF NOT EXISTS download_share_files (
  share_id TEXT NOT NULL REFERENCES download_shares(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, PRIMARY KEY (share_id, file_id)
);
CREATE TABLE IF NOT EXISTS upload_requests (
  id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, secret_hash TEXT NOT NULL, title TEXT NOT NULL, message TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, max_files_per_submission INTEGER NOT NULL,
  max_submissions INTEGER, submission_count INTEGER NOT NULL DEFAULT 0, max_file_size_bytes INTEGER NOT NULL,
  max_total_bytes_per_submission INTEGER NOT NULL, max_total_bytes_all_submissions INTEGER,
  accepted_total_bytes INTEGER NOT NULL DEFAULT 0, allowed_extensions_json TEXT, denied_extensions_json TEXT,
  submitter_name_mode TEXT NOT NULL DEFAULT 'disabled', submitter_message_mode TEXT NOT NULL DEFAULT 'disabled',
  retain_seconds INTEGER NOT NULL DEFAULT 604800, notify_owner INTEGER NOT NULL DEFAULT 1, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS upload_requests_expiry_idx ON upload_requests(expires_at);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, upload_request_id TEXT NOT NULL REFERENCES upload_requests(id) ON DELETE CASCADE,
  public_reference TEXT NOT NULL UNIQUE, submitter_name TEXT, submitter_message TEXT, source_ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL, completed_at INTEGER, file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS capability_sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, source_ip_prefix_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS capability_token_idx ON capability_sessions(token_hash);
CREATE INDEX IF NOT EXISTS capability_expiry_idx ON capability_sessions(expires_at);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, severity TEXT NOT NULL, created_at INTEGER NOT NULL,
  actor_type TEXT NOT NULL, actor_reference TEXT, source_ip_hash TEXT, metadata_json_redacted TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS audit_event_idx ON audit_events(event_type);
CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash TEXT PRIMARY KEY, bucket TEXT NOT NULL, window_started_at INTEGER NOT NULL, attempts INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_updated_idx ON rate_limits(updated_at);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
`;

export function createDatabase(config: AppConfig) {
  mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const sqlite = new Database(config.databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.exec(migrationSql);
  return { sqlite, orm: drizzle(sqlite, { schema }) };
}

export function closeDatabase(database: AppDatabase): void {
  database.sqlite.close();
}
