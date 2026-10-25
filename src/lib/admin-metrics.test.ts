import { describe, expect, it } from "vitest";
import {
  churnPercent,
  computeMrr,
  countPerWeek,
  formatUsd,
  grossMargin,
  microsToCents,
  monthlyEquivalentCents,
  weekStart,
  type PaidSubscription,
} from "./admin-metrics";

const sub = (over: Partial<PaidSubscription> = {}): PaidSubscription => ({
  status: "ACTIVE",
  interval: "MONTH",
  priceMonthlyCents: 14900,
  priceYearlyCents: 149000,
  ...over,
});

describe("MRR", () => {
  it("spreads yearly prices over 12 months", () => {
    expect(monthlyEquivalentCents(sub())).toBe(14900);
    expect(monthlyEquivalentCents(sub({ interval: "YEAR" }))).toBe(12417);
  });
  it("counts active and past-due subscriptions only", () => {
    const subs = [
      sub(),
      sub({ interval: "YEAR" }),
      sub({ status: "PAST_DUE", priceMonthlyCents: 4900 }),
      sub({ status: "TRIALING" }),
      sub({ status: "CANCELED" }),
      sub({ status: "EXPIRED" }),
    ];
    expect(computeMrr(subs)).toBe(14900 + 12417 + 4900);
    expect(computeMrr([])).toBe(0);
  });
});

describe("churn, cost and margin", () => {
  it("churn is a percent with one decimal and safe with nobody", () => {
    expect(churnPercent(1, 8)).toBe(12.5);
    expect(churnPercent(2, 3)).toBe(66.7);
    expect(churnPercent(0, 10)).toBe(0);
    expect(churnPercent(3, 0)).toBe(0);
  });
  it("converts micro-dollars to cents with rounding", () => {
    expect(microsToCents(0)).toBe(0);
    expect(microsToCents(10_000)).toBe(1);
    expect(microsToCents(14_999)).toBe(1);
    expect(microsToCents(15_000)).toBe(2);
    expect(microsToCents(12_345_678)).toBe(1235);
  });
  it("margin is revenue minus cost, with a percent when there is revenue", () => {
    expect(grossMargin(100_000, 25_000)).toEqual({
      revenueCents: 100_000,
      costCents: 25_000,
      marginCents: 75_000,
      percent: 75,
    });
    expect(grossMargin(30_000, 40_000)).toMatchObject({ marginCents: -10_000, percent: -33.3 });
    expect(grossMargin(0, 500)).toMatchObject({ marginCents: -500, percent: null });
  });
  it("formats dollars", () => {
    expect(formatUsd(12345)).toBe("$123.45");
    expect(formatUsd(-500)).toBe("-$5.00");
  });
});

describe("weeks", () => {
  it("finds the Monday of a week", () => {
    expect(weekStart(new Date("2026-03-09T10:00:00Z"))).toBe("2026-03-09");
    expect(weekStart(new Date("2026-03-15T23:59:00Z"))).toBe("2026-03-09");
    expect(weekStart(new Date("2026-03-16T00:00:00Z"))).toBe("2026-03-16");
  });
  it("counts per week and keeps empty weeks", () => {
    const now = new Date("2026-03-18T12:00:00Z");
    const dates = [
      new Date("2026-03-17T00:00:00Z"),
      new Date("2026-03-16T08:00:00Z"),
      new Date("2026-03-03T08:00:00Z"),
      new Date("2025-01-01T00:00:00Z"),
    ];
    expect(countPerWeek(dates, now, 4)).toEqual([
      { week: "2026-02-23", count: 0 },
      { week: "2026-03-02", count: 1 },
      { week: "2026-03-09", count: 0 },
      { week: "2026-03-16", count: 2 },
    ]);
  });
});
