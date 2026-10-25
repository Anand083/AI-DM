import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "9.9.9.9" }),
  cookies: async () => ({ get: () => undefined }),
}));

import { GET as sharedPdf } from "@/app/r/[token]/pdf/route";
import { withTenantAction } from "@/server/auth/actions";
import { MemoryRateLimitStore, type RateLimitStore } from "@/server/rate-limit";
import {
  allow,
  limitRequest,
  mutationAllowed,
  pageLimited,
  setRequestLimitStore,
} from "@/server/request-limit";

const request = (ip: string) =>
  new Request("http://app.test/x", { headers: { "x-forwarded-for": ip } });

afterEach(() => setRequestLimitStore(undefined));

describe("request limits", () => {
  it("answers 429 with Retry-After once the limit is passed, per IP and per name", async () => {
    setRequestLimitStore(new MemoryRateLimitStore());
    for (let i = 0; i < 3; i++)
      expect(await limitRequest(request("1.1.1.1"), "demo", 3)).toBeNull();
    const blocked = await limitRequest(request("1.1.1.1"), "demo", 3);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Other people and other routes have their own budget.
    expect(await limitRequest(request("2.2.2.2"), "demo", 3)).toBeNull();
    expect(await limitRequest(request("1.1.1.1"), "other", 3)).toBeNull();
  });

  it("lets requests through when the store is down", async () => {
    const broken: RateLimitStore = {
      hit: async () => {
        throw new Error("redis is down");
      },
    };
    setRequestLimitStore(broken);
    expect((await allow("k", 1, 60)).allowed).toBe(true);
    expect(await limitRequest(request("1.1.1.1"), "demo", 1)).toBeNull();
  });

  it("limits pages by IP and changes by person", async () => {
    setRequestLimitStore(new MemoryRateLimitStore());
    expect(await pageLimited("p", 2)).toBe(false);
    expect(await pageLimited("p", 2)).toBe(false);
    expect(await pageLimited("p", 2)).toBe(true);
    expect(await mutationAllowed("u1", 2)).toBe(true);
    expect(await mutationAllowed("u1", 2)).toBe(true);
    expect(await mutationAllowed("u1", 2)).toBe(false);
    expect(await mutationAllowed("u2", 2)).toBe(true);
  });

  it("a public route stops too many requests before looking anything up", async () => {
    setRequestLimitStore(new MemoryRateLimitStore());
    const call = () =>
      sharedPdf(request("3.3.3.3"), { params: Promise.resolve({ token: "x".repeat(32) }) });
    for (let i = 0; i < 60; i++) expect((await call()).status).toBe(404);
    expect((await call()).status).toBe(429);
  });

  it("server actions refuse a person who changes things too fast", async () => {
    const calls: number[] = [];
    let allowed = true;
    const action = withTenantAction(
      { permission: "data.view", schema: z.object({}) },
      async () => void calls.push(1),
      {
        getUser: async () => ({
          id: "u",
          name: "U",
          email: "u@x.test",
          emailVerified: true,
          isSuperAdmin: false,
          timezone: "UTC",
        }),
        loadContext: async () => ({ userId: "u", agencyId: "a", role: "OWNER" }),
        checkRate: async () => allowed,
      },
    );
    expect((await action("acme", {})).ok).toBe(true);
    allowed = false;
    const refused = await action("acme", {});
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("too fast") });
    expect(calls).toHaveLength(1);
  });
});
