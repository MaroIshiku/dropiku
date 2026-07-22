import { describe, expect, it } from "vitest";
import { calculateExpiry, extensionAllowed, normalizeFilename, safeContentDisposition } from "../../src/server/storage.js";
import { constantTimeEqual, decryptSmallSecret, encryptSmallSecret, hmac } from "../../src/server/security/primitives.js";
import type { AppConfig } from "../../src/server/config.js";

const config = { masterKey: Buffer.alloc(32, 3) } as AppConfig;

describe("security primitives", () => {
  it("encrypts authenticated small secrets without retaining plaintext", () => {
    const encrypted = encryptSmallSecret(config, "top-secret-value");
    expect(encrypted).not.toContain("top-secret-value");
    expect(decryptSmallSecret(config, encrypted)).toBe("top-secret-value");
  });

  it("hashes capability secrets with purpose separation", () => {
    const download = hmac(config, "download-share", "same-secret");
    const upload = hmac(config, "upload-request", "same-secret");
    expect(download).not.toBe(upload);
    expect(constantTimeEqual(download, hmac(config, "download-share", "same-secret"))).toBe(true);
  });

  it("rejects path components and normalizes safe display names", () => {
    expect(() => normalizeFilename("../../secret.txt")).toThrow();
    expect(() => normalizeFilename("folder\\secret.txt")).toThrow();
    expect(normalizeFilename("  résumé.pdf  ")).toBe("résumé.pdf");
  });

  it("encodes Content-Disposition without header injection", () => {
    const header = safeContentDisposition("résumé\"\r\nX-Bad: yes.pdf");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).toContain("filename*=UTF-8''");
  });

  it("enforces the absolute seven-day expiry", () => {
    expect(calculateExpiry(900, 1000)).toBe(901_000);
    expect(() => calculateExpiry(604_801)).toThrow();
  });

  it("applies case-insensitive extension allow and deny lists", () => {
    expect(extensionAllowed("photo.JPG", ["jpg"], null)).toBe(true);
    expect(extensionAllowed("payload.exe", null, ["EXE"])).toBe(false);
  });
});
