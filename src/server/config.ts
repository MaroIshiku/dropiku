import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AppConfig {
  appBaseUrl: string;
  setupSecret: string;
  masterKey: Buffer;
  dataDir: string;
  databasePath: string;
  filesDir: string;
  temporaryDir: string;
  quarantineDir: string;
  logsDir: string;
  host: string;
  port: number;
  trustProxy: boolean | string;
  secureCookies: boolean;
  maxStorageBytes: number;
  defaultMaxFileBytes: number;
  absoluteMaxFileBytes: number;
  maxConcurrentUploads: number;
  maxConcurrentDownloads: number;
  logLevel: "debug" | "info" | "warn" | "error";
  clamavHost?: string;
  clamavPort: number;
  nodeEnv: string;
}

function readSecret(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) {
    return readFileSync(file, "utf8").trim();
  }
  return env[name]?.trim();
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 1): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}.`);
  }
  return value;
}

function parseMasterKey(value: string | undefined, nodeEnv: string): Buffer {
  if (!value && nodeEnv === "test") return Buffer.alloc(32, 7);
  if (!value) throw new Error("APP_MASTER_KEY or APP_MASTER_KEY_FILE is required.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) {
    throw new Error("APP_MASTER_KEY must contain exactly 32 Base64-encoded random bytes.");
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const appBaseUrl = env.APP_BASE_URL?.replace(/\/$/u, "") ?? (nodeEnv === "test" ? "http://localhost:8080" : "");
  if (!appBaseUrl) throw new Error("APP_BASE_URL is required.");
  const parsedUrl = new URL(appBaseUrl);
  if (nodeEnv === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }

  const setupSecret = readSecret("APP_SETUP_SECRET", env) ?? (nodeEnv === "test" ? "test-setup-secret-with-at-least-32-characters" : "");
  if (setupSecret.length < 32) throw new Error("APP_SETUP_SECRET must contain at least 32 characters.");

  const dataDir = resolve(env.DATA_DIR ?? (nodeEnv === "test" ? "./data-test" : "./data"));
  const logLevel = env.LOG_LEVEL ?? "info";
  if (!(["debug", "info", "warn", "error"] as const).includes(logLevel as AppConfig["logLevel"])) {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error.");
  }

  return {
    appBaseUrl,
    setupSecret,
    masterKey: parseMasterKey(readSecret("APP_MASTER_KEY", env), nodeEnv),
    dataDir,
    databasePath: resolve(dataDir, "database", "dropiku.sqlite"),
    filesDir: resolve(dataDir, "files"),
    temporaryDir: resolve(dataDir, "tmp"),
    quarantineDir: resolve(dataDir, "quarantine"),
    logsDir: resolve(dataDir, "logs"),
    host: env.HOST ?? "0.0.0.0",
    port: integer(env, "PORT", 8080, 1),
    trustProxy: env.TRUSTED_PROXIES === "true" ? true : env.TRUSTED_PROXIES === "false" || !env.TRUSTED_PROXIES ? false : env.TRUSTED_PROXIES,
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE !== "false" : parsedUrl.protocol === "https:",
    maxStorageBytes: integer(env, "MAX_STORAGE_BYTES", 100 * 1024 ** 3),
    defaultMaxFileBytes: integer(env, "DEFAULT_MAX_FILE_BYTES", 5 * 1024 ** 3),
    absoluteMaxFileBytes: integer(env, "ABSOLUTE_MAX_FILE_BYTES", 20 * 1024 ** 3),
    maxConcurrentUploads: integer(env, "MAX_CONCURRENT_UPLOADS", 3),
    maxConcurrentDownloads: integer(env, "MAX_CONCURRENT_DOWNLOADS", 6),
    logLevel: logLevel as AppConfig["logLevel"],
    ...(env.CLAMAV_HOST ? { clamavHost: env.CLAMAV_HOST } : {}),
    clamavPort: integer(env, "CLAMAV_PORT", 3310),
    nodeEnv,
  };
}
