import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const ownerConfig = sqliteTable("owner_config", {
  singletonId: integer("singleton_id").primaryKey().default(1),
  encryptedTotpSecret: text("encrypted_totp_secret").notNull(),
  totpDigits: integer("totp_digits").notNull().default(10),
  totpPeriodSeconds: integer("totp_period_seconds").notNull().default(30),
  totpAlgorithm: text("totp_algorithm").notNull().default("SHA1"),
  lastAcceptedTotpStep: integer("last_accepted_totp_step"),
  setupCompletedAt: integer("setup_completed_at").notNull(),
  recoveryRequiredAt: integer("recovery_required_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const recoveryCodes = sqliteTable("recovery_codes", {
  id: text("id").primaryKey(),
  argon2idHash: text("argon2id_hash").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  csrfHash: text("csrf_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  absoluteExpiresAt: integer("absolute_expires_at").notNull(),
  ipPrefixHash: text("ip_prefix_hash").notNull(),
  userAgentHash: text("user_agent_hash").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => [index("sessions_token_idx").on(table.tokenHash), index("sessions_expiry_idx").on(table.expiresAt)]);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  clientMime: text("client_mime"),
  detectedMime: text("detected_mime").notNull(),
  uploadSourceType: text("upload_source_type").notNull(),
  uploadRequestId: text("upload_request_id"),
  submissionId: text("submission_id"),
  createdAt: integer("created_at").notNull(),
  uploadCompletedAt: integer("upload_completed_at").notNull(),
  expiresAt: integer("expires_at"),
  pinnedAt: integer("pinned_at"),
  scanState: text("scan_state").notNull().default("not_configured"),
  scanDetailSafe: text("scan_detail_safe"),
  deletionState: text("deletion_state").notNull().default("active"),
  ownerDownloadCount: integer("owner_download_count").notNull().default(0),
  publicDownloadCount: integer("public_download_count").notNull().default(0),
}, (table) => [index("files_expiry_idx").on(table.expiresAt), index("files_submission_idx").on(table.submissionId)]);

export const downloadShares = sqliteTable("download_shares", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  maxDownloads: integer("max_downloads"),
  downloadCount: integer("download_count").notNull().default(0),
  revokedAt: integer("revoked_at"),
  behavior: text("behavior").notNull().default("show_landing_page"),
}, (table) => [uniqueIndex("download_shares_public_idx").on(table.publicId), index("download_shares_expiry_idx").on(table.expiresAt)]);

export const downloadShareFiles = sqliteTable("download_share_files", {
  shareId: text("share_id").notNull().references(() => downloadShares.id, { onDelete: "cascade" }),
  fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.shareId, table.fileId] })]);

export const uploadRequests = sqliteTable("upload_requests", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  title: text("title").notNull(),
  message: text("message"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  maxFilesPerSubmission: integer("max_files_per_submission").notNull(),
  maxSubmissions: integer("max_submissions"),
  submissionCount: integer("submission_count").notNull().default(0),
  maxFileSizeBytes: integer("max_file_size_bytes").notNull(),
  maxTotalBytesPerSubmission: integer("max_total_bytes_per_submission").notNull(),
  maxTotalBytesAllSubmissions: integer("max_total_bytes_all_submissions"),
  acceptedTotalBytes: integer("accepted_total_bytes").notNull().default(0),
  allowedExtensionsJson: text("allowed_extensions_json"),
  deniedExtensionsJson: text("denied_extensions_json"),
  submitterNameMode: text("submitter_name_mode").notNull().default("disabled"),
  submitterMessageMode: text("submitter_message_mode").notNull().default("disabled"),
  retainSeconds: integer("retain_seconds").notNull().default(604800),
  notifyOwner: integer("notify_owner", { mode: "boolean" }).notNull().default(true),
  revokedAt: integer("revoked_at"),
}, (table) => [uniqueIndex("upload_requests_public_idx").on(table.publicId), index("upload_requests_expiry_idx").on(table.expiresAt)]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  uploadRequestId: text("upload_request_id").notNull().references(() => uploadRequests.id, { onDelete: "cascade" }),
  publicReference: text("public_reference").notNull().unique(),
  submitterName: text("submitter_name"),
  submitterMessage: text("submitter_message"),
  sourceIpHash: text("source_ip_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  fileCount: integer("file_count").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  state: text("state").notNull().default("pending"),
});

export const capabilitySessions = sqliteTable("capability_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  csrfHash: text("csrf_hash").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  sourceIpPrefixHash: text("source_ip_prefix_hash").notNull(),
}, (table) => [index("capability_token_idx").on(table.tokenHash), index("capability_expiry_idx").on(table.expiresAt)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull(),
  createdAt: integer("created_at").notNull(),
  actorType: text("actor_type").notNull(),
  actorReference: text("actor_reference"),
  sourceIpHash: text("source_ip_hash"),
  metadataJsonRedacted: text("metadata_json_redacted").notNull().default("{}"),
}, (table) => [index("audit_created_idx").on(table.createdAt), index("audit_event_idx").on(table.eventType)]);

export const rateLimits = sqliteTable("rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  bucket: text("bucket").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  attempts: integer("attempts").notNull(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  blockedUntil: integer("blocked_until"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("rate_limits_updated_idx").on(table.updatedAt)]);

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
