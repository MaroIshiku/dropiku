import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, consumeRateLimit, recordRateLimitFailure, resetRateLimit } from "../../src/server/security/rate-limit.js";
import { testApp } from "../helpers.js";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());

describe("persistent rate limiting", () => {
  it("blocks after the configured burst and provides Retry-After", async () => {
    const fixture = await testApp(); cleanup = fixture.close;
    for (let index = 0; index < 3; index += 1) expect(consumeRateLimit(fixture.app.database, fixture.config, { bucket: "test", key: "ip", limit: 3, windowMs: 60_000 }, 1000 + index).allowed).toBe(true);
    const blocked = consumeRateLimit(fixture.app.database, fixture.config, { bucket: "test", key: "ip", limit: 3, windowMs: 60_000, escalationSeconds: [30] }, 1004);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(30);
    resetRateLimit(fixture.app.database, fixture.config, "test", "ip");
    expect(consumeRateLimit(fixture.app.database, fixture.config, { bucket: "test", key: "ip", limit: 3, windowMs: 60_000 }, 1005).allowed).toBe(true);
  });

  it("counts only failures and persists a 30-second lock after the third one", async () => {
    const fixture = await testApp(); cleanup = fixture.close;
    const policy = { bucket: "login", key: "ip", limit: 3, windowMs: 300_000, escalationSeconds: [30, 60] } as const;
    expect(checkRateLimit(fixture.app.database, fixture.config, policy, 1000).allowed).toBe(true);
    expect(recordRateLimitFailure(fixture.app.database, fixture.config, policy, 1001).allowed).toBe(true);
    expect(recordRateLimitFailure(fixture.app.database, fixture.config, policy, 1002).allowed).toBe(true);
    expect(recordRateLimitFailure(fixture.app.database, fixture.config, policy, 1003)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(checkRateLimit(fixture.app.database, fixture.config, policy, 1004)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(checkRateLimit(fixture.app.database, fixture.config, policy, 31_004).allowed).toBe(true);
    expect(recordRateLimitFailure(fixture.app.database, fixture.config, policy, 31_004)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});
