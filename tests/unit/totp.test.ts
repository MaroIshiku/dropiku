import { describe, expect, it } from "vitest";
import { generateTotp, generateTotpCode, totpStep, verifyTotp } from "../../src/server/security/totp.js";

describe("10-digit TOTP", () => {
  it("generates and verifies exactly ten digits including leading zeros", () => {
    const { secret } = generateTotp("test");
    let timestamp = 1_700_000_000_000;
    let token = generateTotpCode(secret, timestamp);
    for (let attempt = 0; attempt < 200 && !token.startsWith("0"); attempt += 1) {
      timestamp += 30_000;
      token = generateTotpCode(secret, timestamp);
    }
    expect(token).toMatch(/^0\d{9}$/u);
    expect(verifyTotp(secret, token, timestamp)).toBe(totpStep(timestamp));
  });

  it("accepts the neighboring rollover window but not a distant step", () => {
    const { secret } = generateTotp("boundary");
    const before = 1_700_000_009_999;
    const token = generateTotpCode(secret, before);
    expect(verifyTotp(secret, token, before + 21_000)).toBe(totpStep(before));
    expect(verifyTotp(secret, token, before + 61_000)).toBeNull();
  });

  it("rejects six-digit and malformed values", () => {
    const { secret } = generateTotp("digits");
    expect(verifyTotp(secret, "123456")).toBeNull();
    expect(verifyTotp(secret, "00000abcde")).toBeNull();
  });
});
