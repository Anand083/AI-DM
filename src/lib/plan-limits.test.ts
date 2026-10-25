import { describe, expect, it } from "vitest";
import { applyAddOns, wouldExceed, type PlanLimits } from "./plan-limits";

describe("wouldExceed", () => {
  it("allows adding up to the limit", () => {
    expect(wouldExceed(5, 4)).toBe(false);
    expect(wouldExceed(5, 5)).toBe(true);
    expect(wouldExceed(5, 3, 2)).toBe(false);
    expect(wouldExceed(5, 4, 2)).toBe(true);
  });
  it("treats -1 as unlimited", () => {
    expect(wouldExceed(-1, 1_000_000)).toBe(false);
  });
  it("blocks everything at a limit of 0", () => {
    expect(wouldExceed(0, 0)).toBe(true);
  });
});

describe("applyAddOns", () => {
  const base = { maxClients: 5, maxProjects: -1, auditPagesPerMonth: 100 } as unknown as PlanLimits;
  it("adds room and keeps unlimited limits", () => {
    const next = applyAddOns(base, [
      { limitKey: "maxClients", amount: 3 },
      { limitKey: "maxClients", amount: 2 },
      { limitKey: "maxProjects", amount: 9 },
      { limitKey: "nonsense", amount: 9 },
    ]);
    expect(next.maxClients).toBe(10);
    expect(next.maxProjects).toBe(-1);
    expect(base.maxClients).toBe(5);
  });
});
