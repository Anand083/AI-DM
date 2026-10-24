import { describe, expect, it } from "vitest";
import { MemoryRateLimitStore } from "@/server/rate-limit";
import { AuthRateLimitError, clientIp, enforceAuthRateLimit } from "./auth-rate-limit";

const config = { limit: 5, windowSec: 900 };

describe("enforceAuthRateLimit", () => {
  it("blocks the sixth sign-in from the same IP, even with different emails", async () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 5; i++) {
      await enforceAuthRateLimit(
        store,
        { path: "/sign-in/email", ip: "1.1.1.1", email: `u${i}@x.test` },
        config,
      );
    }
    await expect(
      enforceAuthRateLimit(
        store,
        { path: "/sign-in/email", ip: "1.1.1.1", email: "u9@x.test" },
        config,
      ),
    ).rejects.toBeInstanceOf(AuthRateLimitError);
  });

  it("blocks the sixth attempt on the same email from different IPs, ignoring case", async () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 5; i++) {
      await enforceAuthRateLimit(
        store,
        { path: "/sign-up/email", ip: `2.2.2.${i}`, email: "Bob@X.test" },
        config,
      );
    }
    await expect(
      enforceAuthRateLimit(
        store,
        { path: "/sign-up/email", ip: "2.2.2.99", email: "bob@x.test" },
        config,
      ),
    ).rejects.toThrow(/Too many attempts/);
  });

  it("limits each action separately", async () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 5; i++) {
      await enforceAuthRateLimit(store, { path: "/sign-in/email", ip: "3.3.3.3" }, config);
    }
    await expect(
      enforceAuthRateLimit(store, { path: "/request-password-reset", ip: "3.3.3.3" }, config),
    ).resolves.toBeUndefined();
  });

  it("ignores paths that are not limited", async () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 20; i++) {
      await enforceAuthRateLimit(store, { path: "/get-session", ip: "4.4.4.4" }, config);
    }
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });
  it("falls back to unknown", () => {
    expect(clientIp(new Headers())).toBe("unknown");
    expect(clientIp(undefined)).toBe("unknown");
  });
});
