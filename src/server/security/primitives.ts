import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config.js";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function hmac(config: AppConfig, purpose: string, value: string): string {
  return createHmac("sha256", config.masterKey).update(`${purpose}\0${value}`).digest("base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

export function encryptSmallSecret(config: AppConfig, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.masterKey, iv);
  cipher.setAAD(Buffer.from("dropiku:v1"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptSmallSecret(config: AppConfig, payload: string): string {
  const [version, ivText, ciphertextText, tagText] = payload.split(".");
  if (version !== "v1" || !ivText || !ciphertextText || !tagText) throw new Error("Unsupported encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", config.masterKey, Buffer.from(ivText, "base64url"));
  decipher.setAAD(Buffer.from("dropiku:v1"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

export function ipPrefix(ip: string): string {
  if (ip.includes(".")) {
    const octets = ip.replace(/^::ffff:/u, "").split(".");
    return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.0/24` : "invalid-ip";
  }
  const groups = ip.split(":");
  return `${groups.slice(0, 4).join(":")}::/56`;
}

export function sourceIpHash(config: AppConfig, ip: string, now = Date.now()): string {
  const rotation = Math.floor(now / (7 * 24 * 60 * 60 * 1000));
  return hmac(config, `ip:${rotation}`, ipPrefix(ip));
}

export function userAgentHash(config: AppConfig, userAgent: string): string {
  return hmac(config, "user-agent", userAgent.slice(0, 512));
}
