import { afterEach, describe, expect, it } from "vitest";
import { consumeRateLimit, resetRateLimit } from "../../src/server/security/rate-limit.js";
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
});
