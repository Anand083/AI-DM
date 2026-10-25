import { describe, expect, it } from "vitest";
import {
  buildPageMap,
  classifyIntent,
  clickShare,
  clusterKeywords,
  explainRankChange,
  findCannibalization,
  opportunityScore,
  significantWords,
} from "./keyword-insights";

describe("classifyIntent", () => {
  it("reads the words of the phrase", () => {
    expect(classifyIntent("buy running shoes online")).toBe("transactional");
    expect(classifyIntent("running shoes price")).toBe("transactional");
    expect(classifyIntent("best running shoes 2026")).toBe("commercial");
    expect(classifyIntent("nike vs adidas")).toBe("commercial");
    expect(classifyIntent("how to choose running shoes")).toBe("informational");
    expect(classifyIntent("dentist near me")).toBe("local");
    expect(classifyIntent("acme dental login", ["Acme Dental"])).toBe("navigational");
    expect(classifyIntent("running shoes")).toBe("informational");
  });
  it("needs whole words, not parts of words", () => {
    expect(classifyIntent("bookshelf ideas")).toBe("informational");
    expect(classifyIntent("book a table")).toBe("transactional");
  });
});

describe("clusters", () => {
  it("drops filler and cuts simple plurals", () => {
    expect(significantWords("The Best Shoes for Running")).toEqual(["shoe", "running"]);
  });
  it("groups phrases about the same thing and names the group", () => {
    const clusters = clusterKeywords([
      "running shoes",
      "best running shoes",
      "running shoes for women",
      "dentist austin",
      "austin dentist prices",
      "pizza",
    ]);
    expect(clusters.map((c) => c.phrases.length)).toEqual([3, 2, 1]);
    expect(clusters[0]!.name).toBe("running shoe");
    expect(clusters[0]!.phrases).toEqual([
      "best running shoes",
      "running shoes",
      "running shoes for women",
    ]);
    expect(clusters[1]!.name).toBe("austin dentist");
  });
  it("keeps unrelated phrases apart and copes with an empty list", () => {
    expect(clusterKeywords([])).toEqual([]);
    expect(clusterKeywords(["red car", "blue boat"])).toHaveLength(2);
    expect(clusterKeywords(["a", "a"])).toHaveLength(1);
  });
});

describe("opportunityScore", () => {
  it("is higher for more volume and an easier keyword", () => {
    const big = opportunityScore({ position: 8, volume: 5000, difficulty: 30 })!;
    const small = opportunityScore({ position: 8, volume: 100, difficulty: 30 })!;
    const hard = opportunityScore({ position: 8, volume: 5000, difficulty: 95 })!;
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(hard);
    expect(big).toBeLessThanOrEqual(100);
    expect(small).toBeGreaterThanOrEqual(0);
  });
  it("is higher the further down the page is, and empty when nothing can be gained or is known", () => {
    expect(opportunityScore({ position: 15, volume: 1000, difficulty: 40 })!).toBeGreaterThan(
      opportunityScore({ position: 5, volume: 1000, difficulty: 40 })!,
    );
    expect(opportunityScore({ position: 2, volume: 1000, difficulty: 40 })).toBeNull();
    expect(opportunityScore({ position: null, volume: 1000, difficulty: 40 })).toBeNull();
    expect(opportunityScore({ position: 9, volume: null, difficulty: 40 })).toBeNull();
    expect(opportunityScore({ position: 9, volume: 0, difficulty: 40 })).toBeNull();
    expect(opportunityScore({ position: 9, volume: 800, difficulty: null })).not.toBeNull();
  });
  it("uses a falling click curve", () => {
    expect(clickShare(1)).toBeGreaterThan(clickShare(2));
    expect(clickShare(10)).toBeGreaterThan(clickShare(11));
    expect(clickShare(50)).toBeLessThan(clickShare(15));
  });
});

describe("cannibalization", () => {
  it("finds a phrase whose page keeps changing", () => {
    const found = findCannibalization([
      { phrase: "seo tips", position: 9, currentUrl: "/b", urlHistory: ["/a", "/b", "/a", "/b"] },
      { phrase: "seo audit", position: 5, currentUrl: "/a", urlHistory: ["/a", "/a", "/a"] },
      { phrase: "seo tool", position: 7, currentUrl: "/a", urlHistory: ["/a", null, "/b"] },
    ]);
    expect(found).toEqual([{ kind: "flip", phrase: "seo tips", urls: ["/a", "/b"], changes: 3 }]);
  });
  it("finds related phrases that rank with different pages", () => {
    const found = findCannibalization([
      { phrase: "running shoes", position: 8, currentUrl: "/shoes", urlHistory: ["/shoes"] },
      {
        phrase: "best running shoes",
        position: 12,
        currentUrl: "/blog/best",
        urlHistory: ["/blog/best"],
      },
      { phrase: "running shoes sale", position: 40, currentUrl: "/sale", urlHistory: ["/sale"] },
      { phrase: "pizza", position: 3, currentUrl: "/pizza", urlHistory: ["/pizza"] },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "competing", cluster: "running shoe" });
    if (found[0]!.kind === "competing") {
      expect(found[0]!.pages.map((p) => p.url).sort()).toEqual(["/blog/best", "/shoes"]);
    }
  });
});

describe("page map", () => {
  it("lists targets with their average position and mismatches, and counts unmapped keywords", () => {
    const map = buildPageMap([
      { targetUrl: "/a", currentUrl: "/a", position: 4 },
      { targetUrl: "/a", currentUrl: "/b", position: 10 },
      { targetUrl: "/a", currentUrl: null, position: null },
      { targetUrl: "/c", currentUrl: "/c", position: 20 },
      { targetUrl: null, currentUrl: "/x", position: 3 },
    ]);
    expect(map.unmapped).toBe(1);
    expect(map.pages).toEqual([
      { url: "/a", keywords: 3, averagePosition: 7, mismatched: 1 },
      { url: "/c", keywords: 1, averagePosition: 20, mismatched: 0 },
    ]);
  });
});

describe("explainRankChange", () => {
  const base = {
    from: 5,
    to: 14,
    urlBefore: "/a",
    urlAfter: "/a",
    featuresBefore: [],
    featuresAfter: [],
    notes: [],
    siteWide: { up: 0, down: 1, total: 10 },
    criticalIssueOnPage: false,
  };
  it("says plainly when nothing explains the move", () => {
    expect(explainRankChange(base)).toEqual([
      expect.objectContaining({ text: "No clear cause found", confidence: "low" }),
    ]);
  });
  it("lists leads with their evidence, most sure first", () => {
    const reasons = explainRankChange({
      ...base,
      urlAfter: "/b",
      featuresAfter: ["ai_overview"],
      notes: [{ on: "2026-03-12", kind: "ALGORITHM", title: "March core update" }],
      siteWide: { up: 0, down: 8, total: 10 },
      criticalIssueOnPage: true,
    });
    expect(reasons[0]).toMatchObject({
      text: "Google now shows a different page of your site",
      confidence: "high",
    });
    const texts = reasons.map((r) => r.text);
    expect(texts).toContain("New elements appeared above the results");
    expect(texts).toContain("A Google update happened around then");
    expect(texts).toContain("Most of your keywords moved the same way");
    expect(texts).toContain("The page has a critical problem in the latest audit");
    expect(reasons.map((r) => r.confidence)).toEqual(
      [...reasons.map((r) => r.confidence)].sort(
        (a, b) => ({ high: 0, medium: 1, low: 2 })[a] - { high: 0, medium: 1, low: 2 }[b],
      ),
    );
  });
  it("does not blame new elements or critical issues for a gain", () => {
    const reasons = explainRankChange({
      ...base,
      from: 14,
      to: 5,
      featuresAfter: ["faq"],
      criticalIssueOnPage: true,
      siteWide: { up: 9, down: 0, total: 10 },
    });
    const texts = reasons.map((r) => r.text);
    expect(texts).not.toContain("New elements appeared above the results");
    expect(texts).not.toContain("The page has a critical problem in the latest audit");
    expect(texts).toContain("Most of your keywords moved the same way");
  });
});
