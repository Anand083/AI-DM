import { describe, expect, it } from "vitest";
import { forecastGoal, formatGoalValue, goalPercent, onTrack, toStored, usesTenths } from "./goals";

describe("units", () => {
  it("stores positions and stars in tenths", () => {
    expect(usesTenths("AVG_POSITION")).toBe(true);
    expect(usesTenths("CLICKS_28D")).toBe(false);
    expect(toStored("AVG_POSITION", 6.5)).toBe(65);
    expect(toStored("TOP10_KEYWORDS", 20)).toBe(20);
    expect(formatGoalValue("AVG_POSITION", 65)).toBe("6.5");
    expect(formatGoalValue("CLICKS_28D", 12345)).toBe("12,345");
    expect(formatGoalValue("CLICKS_28D", null)).toBe("-");
  });
});

describe("goalPercent", () => {
  it("measures the way from the start to the target", () => {
    expect(goalPercent("TOP10_KEYWORDS", 10, 15, 20)).toBe(50);
    expect(goalPercent("TOP10_KEYWORDS", 10, 20, 20)).toBe(100);
    expect(goalPercent("TOP10_KEYWORDS", 10, 25, 20)).toBe(100);
    expect(goalPercent("TOP10_KEYWORDS", 10, 8, 20)).toBe(0);
  });

  it("treats a lower position as better", () => {
    expect(goalPercent("AVG_POSITION", 120, 90, 60)).toBe(50);
    expect(goalPercent("AVG_POSITION", 120, 55, 60)).toBe(100);
    expect(goalPercent("AVG_POSITION", 120, 130, 60)).toBe(0);
  });

  it("copes with missing numbers and never shows 100 before the target", () => {
    expect(goalPercent("TOP10_KEYWORDS", null, null, 20)).toBe(0);
    expect(goalPercent("TOP10_KEYWORDS", null, 10, 20)).toBe(0);
    expect(goalPercent("TOP10_KEYWORDS", 0, 19, 20)).toBe(95);
    expect(goalPercent("TOP10_KEYWORDS", 0, 199, 200)).toBe(99);
  });
});

const line = (start: string, values: number[]) =>
  values.map((value, i) => ({
    on: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
    value,
  }));

describe("forecastGoal", () => {
  it("needs enough points over enough days", () => {
    expect(forecastGoal("CLICKS_28D", line("2026-03-01", [1, 2, 3]), 100, null)).toBeNull();
    expect(forecastGoal("CLICKS_28D", [], 100, null)).toBeNull();
  });

  it("follows a steady rise and says when the target is reached", () => {
    const f = forecastGoal(
      "TOP10_KEYWORDS",
      line("2026-03-01", [10, 11, 12, 13, 14, 15]),
      20,
      "2026-03-20",
    )!;
    expect(f.perDay).toBe(1);
    expect(f.atDue).toBe(29);
    expect(f.reachedOn).toBe("2026-03-11");
    expect(onTrack("TOP10_KEYWORDS", f, 20, "2026-03-20")).toBe(true);
    expect(onTrack("TOP10_KEYWORDS", f, 40, "2026-03-20")).toBe(false);
  });

  it("knows a falling position is progress, and a flat line never gets there", () => {
    const falling = forecastGoal(
      "AVG_POSITION",
      line("2026-03-01", [120, 118, 116, 114, 112, 110]),
      100,
      "2026-03-31",
    )!;
    expect(falling.perDay).toBe(-2);
    expect(falling.reachedOn).toBe("2026-03-11");
    expect(onTrack("AVG_POSITION", falling, 100, "2026-03-31")).toBe(true);
    const flat = forecastGoal(
      "TOP10_KEYWORDS",
      line("2026-03-01", [5, 5, 5, 5, 5, 5]),
      20,
      "2026-03-31",
    )!;
    expect(flat.reachedOn).toBeNull();
    expect(onTrack("TOP10_KEYWORDS", flat, 20, "2026-03-31")).toBe(false);
    expect(onTrack("TOP10_KEYWORDS", flat, 20, null)).toBeNull();
    expect(onTrack("TOP10_KEYWORDS", null, 20, "2026-03-31")).toBeNull();
  });
});
