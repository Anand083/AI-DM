import { describe, expect, it } from "vitest";
import { isRankCheckDue, minuteOffset, weeklyDay } from "./schedule";

const project = (id: string, frequency: "DAILY" | "WEEKLY" = "DAILY", hour = 3) => ({
  id,
  rankCheckFrequency: frequency,
  rankCheckHourUtc: hour,
});

describe("minuteOffset", () => {
  it("is stable, between 0 and 59, and spread out", () => {
    expect(minuteOffset("a")).toBe(minuteOffset("a"));
    const offsets = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const m = minuteOffset(`project-${i}`);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(60);
      offsets.add(m);
    }
    expect(offsets.size).toBeGreaterThan(50);
  });
});

describe("isRankCheckDue (daily)", () => {
  it("is not due before the scheduled hour", () => {
    expect(isRankCheckDue(project("p1"), new Date("2026-03-10T02:59:00Z"))).toBe(false);
  });

  it("becomes due at the project's minute inside its hour, and stays due for the rest of the day", () => {
    const p = project("p1");
    const m = minuteOffset("p1");
    const at = (h: number, min: number) => new Date(Date.UTC(2026, 2, 10, h, min));
    if (m > 0) expect(isRankCheckDue(p, at(3, m - 1))).toBe(false);
    expect(isRankCheckDue(p, at(3, m))).toBe(true);
    expect(isRankCheckDue(p, at(15, 0))).toBe(true);
    expect(isRankCheckDue(p, at(23, 59))).toBe(true);
  });

  it("spreads projects over the hour: only some are due at 03:00 and most by 03:45", () => {
    const at = (min: number) => new Date(Date.UTC(2026, 2, 10, 3, min));
    const ids = Array.from({ length: 600 }, (_, i) => `proj-${i}`);
    const dueAt = (min: number) => ids.filter((id) => isRankCheckDue(project(id), at(min))).length;
    expect(dueAt(0)).toBeLessThan(40);
    expect(dueAt(30)).toBeGreaterThan(200);
    expect(dueAt(30)).toBeLessThan(400);
    expect(dueAt(59)).toBeGreaterThan(550);
  });

  it("respects each project's own hour", () => {
    const now = new Date("2026-03-10T10:30:00Z");
    expect(isRankCheckDue(project("x", "DAILY", 12), now)).toBe(false);
    expect(isRankCheckDue(project("x", "DAILY", 9), now)).toBe(true);
  });
});

describe("isRankCheckDue (weekly)", () => {
  it("is only due on the project's weekday", () => {
    const p = project("weekly-1", "WEEKLY", 0);
    const day = weeklyDay("weekly-1");
    const results = Array.from({ length: 7 }, (_, i) => {
      // 2026-03-08 is a Sunday (day 0).
      const d = new Date(Date.UTC(2026, 2, 8 + i, 23, 59));
      return isRankCheckDue(p, d);
    });
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[day]).toBe(true);
  });
});
