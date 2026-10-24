import { describe, expect, it } from "vitest";
import type { KeywordIdea } from "@/server/providers/seo/types";
import { difficultyLabel, filterIdeas, formatCpc, sparklinePoints } from "./research";

const idea = (
  keyword: string,
  volume: number,
  difficulty: number,
  intent: KeywordIdea["intent"],
  cpcMicros = 1_000_000,
): KeywordIdea => ({
  keyword,
  volume,
  difficulty,
  intent,
  cpcMicros,
  trend: Array(12).fill(volume),
});

const ideas = [
  idea("a cheap", 500, 20, "transactional", 2_500_000),
  idea("b best", 5000, 70, "commercial", 900_000),
  idea("c how", 50, 5, "informational", 100_000),
  idea("d near me", 1200, 45, "local", 3_000_000),
];
const names = (list: KeywordIdea[]) => list.map((i) => i.keyword);

describe("filterIdeas", () => {
  it("sorts by volume, high to low, by default", () => {
    expect(names(filterIdeas(ideas, {}))).toEqual(["b best", "d near me", "a cheap", "c how"]);
  });
  it("sorts by other columns and can flip the direction", () => {
    expect(names(filterIdeas(ideas, { sort: "difficulty" }))).toEqual([
      "c how",
      "a cheap",
      "d near me",
      "b best",
    ]);
    expect(names(filterIdeas(ideas, { sort: "difficulty", dir: "desc" }))).toEqual([
      "b best",
      "d near me",
      "a cheap",
      "c how",
    ]);
    expect(names(filterIdeas(ideas, { sort: "cpc" }))).toEqual([
      "d near me",
      "a cheap",
      "b best",
      "c how",
    ]);
    expect(names(filterIdeas(ideas, { sort: "keyword" }))).toEqual([
      "a cheap",
      "b best",
      "c how",
      "d near me",
    ]);
    expect(names(filterIdeas(ideas, { sort: "volume", dir: "asc" }))).toEqual([
      "c how",
      "a cheap",
      "d near me",
      "b best",
    ]);
  });
  it("filters by intent, minimum volume and maximum difficulty together", () => {
    expect(names(filterIdeas(ideas, { intent: "local" }))).toEqual(["d near me"]);
    expect(names(filterIdeas(ideas, { minVolume: 500 }))).toEqual([
      "b best",
      "d near me",
      "a cheap",
    ]);
    expect(names(filterIdeas(ideas, { maxDifficulty: 45 }))).toEqual([
      "d near me",
      "a cheap",
      "c how",
    ]);
    expect(names(filterIdeas(ideas, { minVolume: 500, maxDifficulty: 45 }))).toEqual([
      "d near me",
      "a cheap",
    ]);
    expect(filterIdeas(ideas, { intent: "navigational" })).toEqual([]);
  });
  it("does not change the original list", () => {
    const copy = [...ideas];
    filterIdeas(ideas, { sort: "keyword" });
    expect(ideas).toEqual(copy);
  });
});

describe("formatting helpers", () => {
  it("formats the price", () => {
    expect(formatCpc(1_250_000)).toBe("$1.25");
    expect(formatCpc(100_000)).toBe("$0.10");
  });
  it("names difficulty", () => {
    expect(difficultyLabel(0)).toBe("Easy");
    expect(difficultyLabel(33)).toBe("Easy");
    expect(difficultyLabel(34)).toBe("Medium");
    expect(difficultyLabel(66)).toBe("Medium");
    expect(difficultyLabel(67)).toBe("Hard");
  });
  it("draws a line from the trend", () => {
    expect(sparklinePoints([])).toBe("");
    const points = sparklinePoints([10, 20, 10, 30], 90, 20).split(" ");
    expect(points).toHaveLength(4);
    expect(points[0]!.startsWith("0.0,")).toBe(true);
    expect(points[3]!.startsWith("90.0,")).toBe(true);
    // The highest value is drawn highest on the screen (smallest y).
    const ys = points.map((p) => Number(p.split(",")[1]));
    expect(ys[3]).toBe(Math.min(...ys));
    expect(sparklinePoints([5, 5, 5]).split(" ")).toHaveLength(3);
  });
});
