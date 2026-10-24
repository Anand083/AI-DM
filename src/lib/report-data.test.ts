import { describe, expect, it } from "vitest";
import { pickPositions, type PeriodCheck } from "./report-data";

const period = { start: "2026-03-01", end: "2026-03-31" };
const c = (
  date: string,
  position: number | null,
  rankingUrl: string | null = null,
): PeriodCheck => ({
  date,
  position,
  rankingUrl,
});

describe("pickPositions", () => {
  it("is unchecked when there is no check up to the last day", () => {
    expect(pickPositions([], period).checked).toBe(false);
    expect(pickPositions([c("2026-04-02", 3)], period).checked).toBe(false);
  });

  it("uses the check on the first day as the start and the latest as the end", () => {
    const r = pickPositions(
      [c("2026-03-01", 10), c("2026-03-15", 6), c("2026-03-30", 4, "https://a.test/x")],
      period,
    );
    expect(r).toEqual({
      position: 4,
      startPosition: 10,
      change: 6,
      url: "https://a.test/x",
      checked: true,
    });
  });

  it("ignores checks after the last day", () => {
    const r = pickPositions([c("2026-03-01", 10), c("2026-03-31", 8), c("2026-04-05", 1)], period);
    expect(r.position).toBe(8);
  });

  it("accepts an earlier check up to 7 days before the start", () => {
    expect(pickPositions([c("2026-02-24", 12), c("2026-03-20", 9)], period).startPosition).toBe(12);
    // 8 days before is too old, so the first check inside the period is not usable either (same as the end check)
    const r = pickPositions([c("2026-02-20", 12), c("2026-03-20", 9)], period);
    expect(r.startPosition).toBeNull();
    expect(r.change).toBeNull();
  });

  it("falls back to the first check inside the period", () => {
    const r = pickPositions([c("2026-03-05", 20), c("2026-03-30", 11)], period);
    expect(r).toMatchObject({ startPosition: 20, position: 11, change: 9 });
  });

  it("does not compare a check with itself", () => {
    expect(pickPositions([c("2026-03-01", 7)], period)).toMatchObject({
      startPosition: null,
      change: null,
    });
  });

  it("has no start when there is only one check", () => {
    expect(pickPositions([c("2026-03-10", 5)], period)).toMatchObject({
      startPosition: null,
      change: null,
      position: 5,
    });
  });

  it("treats not ranking as position 101 for the change", () => {
    const r = pickPositions([c("2026-03-01", null), c("2026-03-30", 50)], period);
    expect(r).toMatchObject({ startPosition: null, position: 50, change: 51 });
    const down = pickPositions([c("2026-03-01", 5), c("2026-03-30", null)], period);
    expect(down).toMatchObject({ startPosition: 5, position: null, change: -96 });
  });
});
