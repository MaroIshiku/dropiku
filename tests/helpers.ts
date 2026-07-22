import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/server/app.js";
import { closeDatabase } from "../src/server/db.js";
import type { AppConfig } from "../src/server/config.js";

export async function testApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "dropiku-test-"));
  const config: AppConfig = {
    appBaseUrl: "http://localhost:8080", setupSecret: "unit-test-setup-secret-with-32-characters", masterKey: Buffer.alloc(32, 9),
    dataDir, databasePath: join(dataDir, "database", "dropiku.sqlite"), filesDir: join(dataDir, "files"), temporaryDir: join(dataDir, "tmp"),
    quarantineDir: join(dataDir, "quarantine"), logsDir: join(dataDir, "logs"), host: "127.0.0.1", port: 0, trustProxy: false,
    secureCookies: false, maxStorageBytes: 100 * 1024 * 1024, defaultMaxFileBytes: 10 * 1024 * 1024, absoluteMaxFileBytes: 20 * 1024 * 1024,
    maxConcurrentUploads: 3, maxConcurrentDownloads: 6, logLevel: "error", clamavPort: 3310, nodeEnv: "test",
  };
  const app = await buildApp(config);
  return {
    app, config,
    async close() { await app.close(); closeDatabase(app.database); await rm(dataDir, { recursive: true, force: true }); },
  };
}

export function cookieHeader(response: LightMyRequestResponse): string {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function mergeCookies(...headers: string[]): string {
  const values = new Map<string, string>();
  for (const header of headers) for (const item of header.split("; ").filter((part) => part.includes("="))) values.set(item.slice(0, item.indexOf("=")), item);
  return [...values.values()].join("; ");
}

export function multipart(filename: string, content: Buffer, mime = "application/octet-stream") {
  const boundary = `dropiku-${Date.now().toString(16)}`;
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, payload: Buffer.concat([prefix, content, suffix]) };
}
