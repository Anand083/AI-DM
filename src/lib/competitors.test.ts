import { describe, expect, it } from "vitest";
import {
  findGap,
  positionInTop,
  sortComparison,
  summarizeCompetitors,
  type ComparisonRow,
} from "./competitors";

describe("positionInTop", () => {
  const results = [
    { position: 1, domain: "big.com" },
    { position: 3, domain: "WWW.rival.com" },
    { position: 7, domain: "rival.com" },
  ];

  it("finds the best position of a domain, ignoring case and www", () => {
    expect(positionInTop(results, "rival.com")).toBe(3);
    expect(positionInTop(results, "big.com")).toBe(1);
  });

  it("is null when the domain is not in the list", () => {
    expect(positionInTop(results, "other.com")).toBeNull();
    expect(positionInTop([], "rival.com")).toBeNull();
  });
});

const rows: ComparisonRow[] = [
  { phrase: "a", you: 5, competitors: { "x.com": 2, "y.com": null } },
  { phrase: "b", you: 2, competitors: { "x.com": 6, "y.com": 1 } },
  { phrase: "c", you: null, competitors: { "x.com": 10, "y.com": null } },
  { phrase: "d", you: 40, competitors: { "x.com": null, "y.com": null } },
];

describe("summarizeCompetitors", () => {
  it("counts who is ahead and the average position inside the top 10", () => {
    expect(summarizeCompetitors(rows, ["x.com", "y.com"])).toEqual([
      { domain: "x.com", inTop10: 3, theyAreAhead: 2, youAreAhead: 2, averagePosition: 6 },
      { domain: "y.com", inTop10: 1, theyAreAhead: 1, youAreAhead: 3, averagePosition: 1 },
    ]);
  });

  it("has no average when a competitor is never in the top 10", () => {
    expect(summarizeCompetitors([rows[3]!], ["x.com"])[0]).toMatchObject({
      inTop10: 0,
      averagePosition: null,
    });
    expect(summarizeCompetitors([], ["x.com"])[0]?.youAreAhead).toBe(0);
  });
});

describe("sortComparison", () => {
  it("puts keywords where a competitor beats you first", () => {
    expect(sortComparison(rows).map((r) => r.phrase)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("findGap", () => {
  const rival = [
    { keyword: "Red Shoes", position: 4, volume: 900, url: null },
    { keyword: "red shoes", position: 6, volume: 900, url: null },
    { keyword: "blue shoes", position: 2, volume: 3000, url: "https://x.com/b" },
    { keyword: "tracked one", position: 1, volume: 5000, url: null },
    { keyword: "we rank", position: 1, volume: 7000, url: null },
    { keyword: "small", position: 9, volume: 10, url: null },
  ];

  it("drops what we rank for or track, merges duplicates and sorts by volume", () => {
    const gap = findGap(rival, new Set(["we rank"]), new Set(["tracked one"]), 10);
    expect(gap.map((g) => g.keyword)).toEqual(["blue shoes", "red shoes", "small"]);
    expect(gap[1]?.position).toBe(4);
  });

  it("respects the limit", () => {
    expect(findGap(rival, new Set(), new Set(), 2)).toHaveLength(2);
  });
});
