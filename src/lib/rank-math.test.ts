import { describe, expect, it } from "vitest";
import {
  averagePosition,
  bucketOf,
  buildSnapshot,
  ctrWeight,
  distribution,
  formatChange,
  formatPosition,
  rankChange,
  visibilityScore,
  type CheckPoint,
} from "./rank-math";

describe("rankChange", () => {
  it("is positive when a keyword moves up the page", () => {
    expect(rankChange(12, 8)).toBe(4);
    expect(rankChange(8, 12)).toBe(-4);
    expect(rankChange(5, 5)).toBe(0);
  });
  it("counts 'not ranking' as 101", () => {
    expect(rankChange(null, 50)).toBe(51);
    expect(rankChange(50, null)).toBe(-51);
    expect(rankChange(null, null)).toBe(0);
    expect(rankChange(100, null)).toBe(-1);
  });
});

describe("formatting", () => {
  it("shows 100+ for not ranking", () => {
    expect(formatPosition(null)).toBe("100+");
    expect(formatPosition(7)).toBe("7");
  });
  it("shows signs on changes", () => {
    expect(formatChange(4)).toBe("+4");
    expect(formatChange(-2)).toBe("-2");
    expect(formatChange(0)).toBe("0");
    expect(formatChange(null)).toBe("-");
  });
});

describe("ctrWeight and visibilityScore", () => {
  it("uses the plan's weights", () => {
    expect([1, 2, 3, 4, 5].map(ctrWeight)).toEqual([0.3, 0.15, 0.1, 0.07, 0.05]);
    for (const p of [6, 8, 10]) expect(ctrWeight(p)).toBe(0.03);
    for (const p of [11, 15, 20]) expect(ctrWeight(p)).toBe(0.01);
    for (const p of [21, 50, 100]) expect(ctrWeight(p)).toBe(0);
    expect(ctrWeight(null)).toBe(0);
  });
  it("is the average weight times 100", () => {
    expect(visibilityScore([1])).toBe(30);
    expect(visibilityScore([1, 2])).toBe(22.5);
    expect(visibilityScore([1, null, null, null])).toBe(7.5);
    expect(visibilityScore([null, 30, 100])).toBe(0);
    expect(visibilityScore([])).toBe(0);
    expect(visibilityScore([1, 1, 1])).toBe(30);
  });
});

describe("distribution", () => {
  it("puts positions in the plan's buckets", () => {
    expect(bucketOf(1)).toBe("top3");
    expect(bucketOf(3)).toBe("top3");
    expect(bucketOf(4)).toBe("top10");
    expect(bucketOf(10)).toBe("top10");
    expect(bucketOf(11)).toBe("top20");
    expect(bucketOf(20)).toBe("top20");
    expect(bucketOf(21)).toBe("top50");
    expect(bucketOf(50)).toBe("top50");
    expect(bucketOf(51)).toBe("top100");
    expect(bucketOf(100)).toBe("top100");
    expect(bucketOf(null)).toBe("none");
  });
  it("counts every keyword once", () => {
    const d = distribution([1, 2, 5, 12, 40, 70, null, null]);
    expect(d).toEqual({ top3: 2, top10: 1, top20: 1, top50: 1, top100: 1, none: 2 });
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBe(8);
  });
});

describe("averagePosition", () => {
  it("ignores keywords that do not rank", () => {
    expect(averagePosition([2, 4, null])).toBe(3);
    expect(averagePosition([null, null])).toBeNull();
    expect(averagePosition([1, 2, 2])).toBe(1.7);
  });
});

describe("buildSnapshot", () => {
  const check = (date: string, position: number | null): CheckPoint => ({
    date,
    position,
    rankingUrl: position === null ? null : `https://x.test/${position}`,
    serpFeatures: [],
  });

  it("returns null without checks", () => {
    expect(buildSnapshot([])).toBeNull();
  });

  it("uses the latest check and has no changes with one check", () => {
    const s = buildSnapshot([check("2026-03-10", 9)])!;
    expect(s).toMatchObject({
      lastCheckedOn: "2026-03-10",
      currentPosition: 9,
      currentUrl: "https://x.test/9",
      bestPosition: 9,
      changeDay: null,
      changeWeek: null,
      changeMonth: null,
    });
  });

  it("compares with 1, 7 and 30 days earlier", () => {
    const checks = [
      check("2026-03-10", 5),
      check("2026-03-09", 8),
      check("2026-03-03", 20),
      check("2026-02-08", null),
    ];
    const s = buildSnapshot(checks)!;
    expect(s.changeDay).toBe(3); // 8 -> 5
    expect(s.changeWeek).toBe(15); // 20 -> 5
    expect(s.changeMonth).toBe(96); // not ranking (101) -> 5
    expect(s.bestPosition).toBe(5);
  });

  it("uses the nearest earlier check when a day was missed, but not one that is too old", () => {
    const s = buildSnapshot([check("2026-03-10", 10), check("2026-03-01", 30)])!;
    // 7 days before 03-10 is 03-03; the nearest earlier check is 03-01 (2 days back): fine.
    expect(s.changeWeek).toBe(20);
    // 1 day before is 03-09; 03-01 is 8 days too far back.
    expect(s.changeDay).toBeNull();
  });

  it("handles unsorted input and a keyword that dropped out", () => {
    const s = buildSnapshot([
      check("2026-03-08", 3),
      check("2026-03-10", null),
      check("2026-03-09", 4),
    ])!;
    expect(s).toMatchObject({
      currentPosition: null,
      currentUrl: null,
      lastCheckedOn: "2026-03-10",
    });
    expect(s.changeDay).toBe(-97); // 4 -> 101
    expect(s.bestPosition).toBe(3);
  });

  it("uses the best position of the whole history when given", () => {
    expect(buildSnapshot([check("2026-03-10", 9)], 2)!.bestPosition).toBe(2);
    expect(buildSnapshot([check("2026-03-10", 9)], null)!.bestPosition).toBe(9);
    expect(buildSnapshot([check("2026-03-10", null)])!.bestPosition).toBeNull();
  });
});
