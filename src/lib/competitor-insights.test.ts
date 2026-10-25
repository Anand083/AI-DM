import { describe, expect, it } from "vitest";
import {
  anchorDistribution,
  classifyAnchor,
  competitorWeekly,
  detectCompetitorMove,
  discoverCompetitors,
  linkGap,
  weekEnds,
  type WeekPoint,
} from "./competitor-insights";

const top = (...domains: string[]) => domains.map((domain, i) => ({ position: i + 1, domain }));

describe("discoverCompetitors", () => {
  it("suggests sites that keep appearing, not you, not tracked ones, not big general sites", () => {
    const tops = [
      top("rival.com", "wikipedia.org", "mine.com", "known.com"),
      top("rival.com", "other.com", "known.com"),
      top("rival.com", "other.com", "www.mine.com"),
      top("youtube.com", "other.com", "rival.com"),
      top("lonely.com"),
      [],
    ];
    const found = discoverCompetitors(tops, "mine.com", ["known.com"]);
    expect(found).toEqual([
      { domain: "rival.com", keywords: 4, share: 80, averagePosition: 1.5 },
      { domain: "other.com", keywords: 3, share: 60, averagePosition: 2 },
    ]);
  });
  it("needs more than a single appearance and handles no data", () => {
    expect(discoverCompetitors([top("a.com")], "m.com", [])).toEqual([]);
    expect(discoverCompetitors([], "m.com", [])).toEqual([]);
  });
});

describe("competitorWeekly and weekEnds", () => {
  it("lists the last days of the weeks, oldest first", () => {
    expect(weekEnds("2026-03-29", 3)).toEqual(["2026-03-15", "2026-03-22", "2026-03-29"]);
  });
  it("counts top 10 places per website from the newest check of each keyword in the week", () => {
    const checks = [
      { keywordId: "k1", date: "2026-03-20", topResults: top("rival.com", "mine.com") },
      { keywordId: "k1", date: "2026-03-22", topResults: top("mine.com", "rival.com") },
      { keywordId: "k2", date: "2026-03-21", topResults: top("other.com", "rival.com") },
      { keywordId: "k3", date: "2026-03-10", topResults: top("rival.com") },
    ];
    const [w] = competitorWeekly(checks, ["rival.com", "mine.com"], ["2026-03-22"]);
    expect(w).toEqual({
      weekEnd: "2026-03-22",
      keywords: 2,
      byDomain: {
        "rival.com": { top10: 2, averagePosition: 2 },
        "mine.com": { top10: 1, averagePosition: 1 },
      },
    });
  });
});

describe("detectCompetitorMove", () => {
  const week = (keywords: number, top10: number): WeekPoint => ({
    weekEnd: "x",
    keywords,
    byDomain: { "rival.com": { top10, averagePosition: 5 } },
  });
  it("flags a clear rise only", () => {
    expect(detectCompetitorMove(week(20, 4), week(20, 9), "rival.com")).toEqual({ from: 4, to: 9 });
    expect(detectCompetitorMove(week(20, 0), week(20, 3), "rival.com")).toEqual({ from: 0, to: 3 });
    expect(detectCompetitorMove(week(20, 20), week(20, 24), "rival.com")).toBeNull();
    expect(detectCompetitorMove(week(20, 4), week(20, 6), "rival.com")).toBeNull();
    expect(detectCompetitorMove(week(3, 0), week(3, 3), "rival.com")).toBeNull();
    expect(detectCompetitorMove(undefined, week(20, 9), "rival.com")).toBeNull();
  });
});

describe("linkGap", () => {
  it("lists sites that link to rivals but not to you, the most shared first", () => {
    const gap = linkGap(new Set(["mine-fan.com"]), [
      {
        domain: "a.com",
        links: [
          { sourceDomain: "blog.com", rating: 40 },
          { sourceDomain: "mine-fan.com", rating: 90 },
          { sourceDomain: "a.com", rating: 99 },
        ],
      },
      {
        domain: "b.com",
        links: [
          { sourceDomain: "www.blog.com", rating: 55 },
          { sourceDomain: "news.com", rating: 80 },
        ],
      },
    ]);
    expect(gap).toEqual([
      { sourceDomain: "blog.com", rating: 55, competitors: ["a.com", "b.com"] },
      { sourceDomain: "news.com", rating: 80, competitors: ["b.com"] },
    ]);
  });
});

describe("anchors", () => {
  const brand = ["Acme Dental", "acmedental"];
  const keywords = ["dentist austin", "teeth whitening"];
  it("classifies the text of a link", () => {
    expect(classifyAnchor("Acme Dental", brand, keywords)).toBe("branded");
    expect(classifyAnchor("", brand, keywords)).toBe("empty");
    expect(classifyAnchor("https://acmedental.com/x", brand, keywords)).toBe("url");
    expect(classifyAnchor("acmedental.com", [], keywords)).toBe("url");
    expect(classifyAnchor("Click here", brand, keywords)).toBe("generic");
    expect(classifyAnchor("Dentist Austin", brand, keywords)).toBe("exact");
    expect(classifyAnchor("a great austin dentist", brand, keywords)).toBe("partial");
    expect(classifyAnchor("my favourite place", brand, keywords)).toBe("other");
  });
  it("gives shares and warns when exact keywords are over-used", () => {
    const anchors = [...Array(8).fill("dentist austin"), ...Array(12).fill("Acme Dental")];
    const d = anchorDistribution(anchors, brand, keywords);
    expect(d.total).toBe(20);
    expect(d.rows[0]).toEqual({ kind: "branded", count: 12, percent: 60 });
    expect(d.overOptimised).toBe(true);
    expect(anchorDistribution(anchors.slice(0, 10), brand, keywords).overOptimised).toBe(false);
    expect(anchorDistribution([], brand, keywords)).toEqual({
      total: 0,
      rows: [],
      overOptimised: false,
    });
  });
});
