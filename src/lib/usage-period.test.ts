import { describe, expect, it } from "vitest";
import {
  addMonthsUtc,
  calendarMonth,
  currentUsagePeriod,
  subscriptionUsagePeriod,
} from "./usage-period";

const d = (s: string) => new Date(s);
const iso = (x: Date) => x.toISOString();

describe("addMonthsUtc", () => {
  it("adds months and clamps to the end of shorter months", () => {
    expect(iso(addMonthsUtc(d("2026-01-31T10:00:00Z"), 1))).toBe("2026-02-28T10:00:00.000Z");
    expect(iso(addMonthsUtc(d("2028-01-31T10:00:00Z"), 1))).toBe("2028-02-29T10:00:00.000Z");
    expect(iso(addMonthsUtc(d("2026-03-31T00:00:00Z"), 1))).toBe("2026-04-30T00:00:00.000Z");
    expect(iso(addMonthsUtc(d("2026-11-15T00:00:00Z"), 3))).toBe("2027-02-15T00:00:00.000Z");
    expect(iso(addMonthsUtc(d("2026-02-10T00:00:00Z"), -3))).toBe("2025-11-10T00:00:00.000Z");
  });
});

describe("currentUsagePeriod (monthly)", () => {
  const anchor = d("2026-03-10T08:00:00Z");
  it("is the first window right after the anchor", () => {
    const p = currentUsagePeriod(anchor, d("2026-03-10T08:00:00Z"));
    expect([iso(p.start), iso(p.end)]).toEqual([
      "2026-03-10T08:00:00.000Z",
      "2026-04-10T08:00:00.000Z",
    ]);
  });
  it("moves to the next window on the same day and time each month", () => {
    expect(iso(currentUsagePeriod(anchor, d("2026-04-10T07:59:59Z")).start)).toBe(
      "2026-03-10T08:00:00.000Z",
    );
    expect(iso(currentUsagePeriod(anchor, d("2026-04-10T08:00:00Z")).start)).toBe(
      "2026-04-10T08:00:00.000Z",
    );
  });
  it("handles an anchor on the 31st", () => {
    const a = d("2026-01-31T00:00:00Z");
    const p = currentUsagePeriod(a, d("2026-03-05T00:00:00Z"));
    expect([iso(p.start), iso(p.end)]).toEqual([
      "2026-02-28T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    ]);
  });
  it("keeps rolling for a yearly plan: 7 months in, still a one month window", () => {
    const yearStart = d("2026-01-15T00:00:00Z");
    const p = currentUsagePeriod(yearStart, d("2026-08-20T00:00:00Z"));
    expect([iso(p.start), iso(p.end)]).toEqual([
      "2026-08-15T00:00:00.000Z",
      "2026-09-15T00:00:00.000Z",
    ]);
  });
  it("copes with a time before the anchor", () => {
    const p = currentUsagePeriod(anchor, d("2026-03-01T00:00:00Z"));
    expect(iso(p.start)).toBe("2026-03-10T08:00:00.000Z");
  });
  it("can cap the end", () => {
    const p = currentUsagePeriod(anchor, d("2026-03-12T00:00:00Z"), d("2026-03-24T08:00:00Z"));
    expect(iso(p.end)).toBe("2026-03-24T08:00:00.000Z");
  });
});

describe("subscriptionUsagePeriod", () => {
  const created = d("2026-03-01T00:00:00Z");
  it("trial: starts 14 days before the trial ends and ends when the trial ends", () => {
    const p = subscriptionUsagePeriod(
      {
        status: "TRIALING",
        trialEndsAt: d("2026-03-15T00:00:00Z"),
        currentPeriodStart: null,
        currentPeriodEnd: null,
        createdAt: created,
      },
      d("2026-03-05T00:00:00Z"),
    );
    expect([iso(p.start), iso(p.end)]).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-15T00:00:00.000Z",
    ]);
  });
  it("active monthly: uses the billing period start", () => {
    const p = subscriptionUsagePeriod(
      {
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodStart: d("2026-03-20T00:00:00Z"),
        currentPeriodEnd: d("2026-04-20T00:00:00Z"),
        createdAt: created,
      },
      d("2026-04-02T00:00:00Z"),
    );
    expect([iso(p.start), iso(p.end)]).toEqual([
      "2026-03-20T00:00:00.000Z",
      "2026-04-20T00:00:00.000Z",
    ]);
  });
  it("falls back to the creation date", () => {
    const p = subscriptionUsagePeriod(
      {
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        createdAt: created,
      },
      d("2026-03-05T00:00:00Z"),
    );
    expect(iso(p.start)).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("calendarMonth", () => {
  it("is the UTC calendar month", () => {
    const m = calendarMonth(d("2026-02-17T13:00:00Z"));
    expect([iso(m.start), iso(m.end)]).toEqual([
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });
});
