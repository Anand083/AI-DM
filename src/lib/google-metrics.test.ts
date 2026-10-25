import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInRange,
  formatPositionTenths,
  formatTenthsPercent,
  percentChange,
  previousPeriod,
  sumAnalytics,
  sumSearch,
  syncRanges,
} from "./google-metrics";

describe("dates", () => {
  it("adds days across months and counts both ends", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2026-03-02", -3)).toBe("2026-02-27");
    expect(daysInRange("2026-03-01", "2026-03-28")).toBe(28);
    expect(daysInRange("2026-03-01", "2026-03-01")).toBe(1);
  });

  it("finds the period of the same length before", () => {
    expect(previousPeriod("2026-03-01", "2026-03-28")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
});

describe("syncRanges", () => {
  it("goes back 90 days the first time and stops 2 days (Search Console) or 1 day (Analytics) ago", () => {
    expect(syncRanges(null, "2026-03-10")).toEqual({
      gsc: { start: "2025-12-10", end: "2026-03-08" },
      ga4: { start: "2025-12-10", end: "2026-03-09" },
    });
  });

  it("starts 5 days before the last sync later on", () => {
    expect(syncRanges("2026-03-08", "2026-03-10")).toEqual({
      gsc: { start: "2026-03-03", end: "2026-03-08" },
      ga4: { start: "2026-03-03", end: "2026-03-09" },
    });
  });

  it("has nothing to read when the start is after the end", () => {
    // A last sync date in the future (clock moved back) must not ask Google for an empty range.
    expect(syncRanges("2026-03-30", "2026-03-10")).toEqual({ gsc: null, ga4: null });
    // Synced today: the overlap still reaches back far enough to read the last days.
    expect(syncRanges("2026-03-10", "2026-03-10").gsc).toEqual({
      start: "2026-03-05",
      end: "2026-03-08",
    });
  });
});

describe("sums", () => {
  it("adds clicks and impressions and weights the position by impressions", () => {
    const totals = sumSearch([
      { clicks: 10, impressions: 100, positionTenths: 50 },
      { clicks: 30, impressions: 300, positionTenths: 90 },
    ]);
    expect(totals).toEqual({
      clicks: 40,
      impressions: 400,
      ctrTenthsPercent: 100,
      positionTenths: 80,
    });
  });

  it("is zero for no rows or no impressions", () => {
    expect(sumSearch([])).toEqual({
      clicks: 0,
      impressions: 0,
      ctrTenthsPercent: 0,
      positionTenths: null,
    });
    expect(sumAnalytics([])).toEqual({ sessions: 0, conversions: 0 });
    expect(
      sumAnalytics([
        { sessions: 5, conversions: 1 },
        { sessions: 7, conversions: 0 },
      ]),
    ).toEqual({ sessions: 12, conversions: 1 });
  });

  it("formats and compares", () => {
    expect(formatTenthsPercent(35)).toBe("3.5%");
    expect(formatPositionTenths(73)).toBe("7.3");
    expect(formatPositionTenths(null)).toBe("-");
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(5, 0)).toBeNull();
  });
});
