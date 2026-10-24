import { describe, expect, it } from "vitest";
import { createProviderHealth } from "./provider-health";

describe("createProviderHealth", () => {
  it("calls the provider once and remembers the answer for 5 minutes", async () => {
    let calls = 0;
    let now = 0;
    const check = createProviderHealth({
      probes: {
        dataforseo: async () => {
          calls++;
          return { ok: true, balanceUsd: 12 };
        },
      },
      now: () => now,
    });
    expect(await check(["dataforseo"])).toEqual({ dataforseo: { ok: true, balanceUsd: 12 } });
    now = 4 * 60_000;
    await check(["dataforseo"]);
    expect(calls).toBe(1);
    now = 5 * 60_000 + 1;
    await check(["dataforseo"]);
    expect(calls).toBe(2);
  });

  it("turns errors into ok: false and unknown names into a clear answer", async () => {
    const check = createProviderHealth({
      probes: {
        broken: async () => {
          throw new Error("no route to host");
        },
      },
    });
    expect(await check(["broken", "other"])).toEqual({
      broken: { ok: false, message: "no route to host" },
      other: { ok: false, message: "Unknown provider" },
    });
  });
});
