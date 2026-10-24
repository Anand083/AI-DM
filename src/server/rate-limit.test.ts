import { describe, expect, it } from "vitest";
import { consume, MemoryRateLimitStore } from "./rate-limit";

describe("consume", () => {
  it("allows up to the limit, then blocks with a retry time", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    const opts = { key: "k", limit: 5, windowSec: 900 };
    for (let i = 0; i < 5; i++) expect((await consume(store, opts)).allowed).toBe(true);
    const blocked = await consume(store, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBe(900);
    now = 300_000;
    expect((await consume(store, opts)).retryAfterSec).toBe(600);
  });

  it("starts a new window after the old one ends", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    const opts = { key: "k", limit: 1, windowSec: 60 };
    await consume(store, opts);
    expect((await consume(store, opts)).allowed).toBe(false);
    now = 61_000;
    expect((await consume(store, opts)).allowed).toBe(true);
  });

  it("counts keys separately", async () => {
    const store = new MemoryRateLimitStore();
    await consume(store, { key: "a", limit: 1, windowSec: 60 });
    expect((await consume(store, { key: "b", limit: 1, windowSec: 60 })).allowed).toBe(true);
  });
});
