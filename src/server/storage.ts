import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { chmod, rename, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { basename, extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import type { Readable } from "node:stream";
import type { AppConfig } from "./config.js";
import { randomToken } from "./security/primitives.js";

export interface StagedFile {
  displayName: string;
  storageKey: string;
  finalPath: string;
  sizeBytes: number;
  sha256: string;
  clientMime: string | null;
  detectedMime: string;
  scanState: "not_configured" | "clean" | "infected" | "scan_error";
  scanDetailSafe: string | null;
}

export class UploadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadLimitError";
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly maximum: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.maximum) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

export function ensureStorage(config: AppConfig): void {
  for (const directory of [config.filesDir, config.temporaryDir, config.quarantineDir, config.logsDir]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
}

export function normalizeFilename(input: string): string {
  const normalized = [...input.normalize("NFKC")].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && code !== 127;
  }).join("").trim();
  if (!normalized || normalized !== basename(normalized) || /[/\\]/u.test(normalized) || normalized === "." || normalized === "..") {
    throw new UploadLimitError("The file name is not valid.");
  }
  const characters = [...normalized];
  return characters.length > 255 ? characters.slice(0, 255).join("") : normalized;
}

export function safeContentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_").slice(0, 180) || "download";
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

export function extensionAllowed(filename: string, allowed: readonly string[] | null, denied: readonly string[] | null): boolean {
  const extension = extname(filename).toLocaleLowerCase("en-US").replace(/^\./u, "");
  if (denied?.some((item) => item.toLocaleLowerCase("en-US").replace(/^\./u, "") === extension)) return false;
  return !allowed?.length || allowed.some((item) => item.toLocaleLowerCase("en-US").replace(/^\./u, "") === extension);
}

export async function ingestFile(
  config: AppConfig,
  stream: Readable,
  options: { filename: string; clientMime?: string; maximumBytes: number },
): Promise<StagedFile> {
  const displayName = normalizeFilename(options.filename);
  const storageKey = randomToken(32);
  const temporaryPath = join(config.temporaryDir, `${storageKey}.part`);
  let finalPath = join(config.filesDir, storageKey);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > options.maximumBytes) {
        callback(new UploadLimitError("The file exceeds the configured size limit."));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, limiter, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    if (sizeBytes === 0) throw new UploadLimitError("Empty files are not accepted.");
    const detected = await fileTypeFromFile(temporaryPath);
    const scan = await scanWithClamAv(config, temporaryPath);
    if (scan.state === "infected" || scan.state === "scan_error") finalPath = join(config.quarantineDir, storageKey);
    await rename(temporaryPath, finalPath);
    await chmod(finalPath, 0o600);
    return {
      displayName,
      storageKey,
      finalPath,
      sizeBytes,
      sha256: hash.digest("hex"),
      clientMime: options.clientMime?.slice(0, 255) ?? null,
      detectedMime: detected?.mime ?? "application/octet-stream",
      scanState: scan.state,
      scanDetailSafe: scan.detail,
    };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await rm(finalPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function scanWithClamAv(config: AppConfig, path: string): Promise<{ state: StagedFile["scanState"]; detail: string | null }> {
  if (!config.clamavHost) return { state: "not_configured", detail: null };
  try {
    const socket = createConnection({ host: config.clamavHost, port: config.clamavPort });
    socket.setTimeout(120_000);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); socket.once("timeout", () => reject(new Error("ClamAV connection timed out."))); });
    socket.write("zINSTREAM\0");
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const length = Buffer.allocUnsafe(4); length.writeUInt32BE(data.length);
      if (!socket.write(Buffer.concat([length, data]))) await new Promise<void>((resolve) => socket.once("drain", resolve));
    }
    socket.write(Buffer.alloc(4));
    const response = await new Promise<string>((resolve, reject) => {
      let value = "";
      socket.on("data", (chunk: Buffer) => { value += chunk.toString("utf8"); });
      socket.once("end", () => resolve(value));
      socket.once("error", reject);
      socket.once("timeout", () => reject(new Error("ClamAV scan timed out.")));
    });
    socket.destroy();
    if (response.includes("FOUND")) return { state: "infected", detail: "Malware was detected; the file is quarantined." };
    if (response.includes("OK")) return { state: "clean", detail: null };
    return { state: "scan_error", detail: "The scanner returned an unexpected result; the file is quarantined." };
  } catch {
    return { state: "scan_error", detail: "The malware scanner could not complete; the file is quarantined." };
  }
}

export async function discardStaged(file: StagedFile): Promise<void> {
  await rm(file.finalPath, { force: true });
}

export function openStoredFile(config: AppConfig, storageKey: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/u.test(storageKey)) throw new Error("Invalid storage key.");
  return createReadStream(join(config.filesDir, storageKey));
}

export async function storedFileExists(config: AppConfig, storageKey: string): Promise<boolean> {
  try {
    const info = await stat(join(config.filesDir, storageKey));
    return info.isFile();
  } catch {
    return false;
  }
}

export function calculateExpiry(seconds: number, now = Date.now()): number {
  if (!Number.isSafeInteger(seconds) || seconds < 15 * 60 || seconds > 7 * 24 * 60 * 60) {
    throw new UploadLimitError("Expiry must be between 15 minutes and 7 days.");
  }
  return now + seconds * 1000;
}
