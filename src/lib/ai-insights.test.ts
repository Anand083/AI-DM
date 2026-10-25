import { describe, expect, it } from "vitest";
import {
  buildRecommendations,
  citationDomains,
  competitorComparison,
  describeCoverage,
  hostOf,
  trendBy,
  type CheckRow,
} from "./ai-insights";

const row = (o: Partial<CheckRow> = {}): CheckRow => ({
  promptId: "p1",
  engine: "chatgpt",
  checkedOn: "2026-03-01",
  brandMentioned: false,
  domainCited: false,
  mentionPosition: null,
  sentiment: null,
  citedUrls: [],
  competitorsMentioned: [],
  ...o,
});

describe("citationDomains", () => {
  it("counts websites, marks your site and competitors, and ignores bad links", () => {
    const rows = citationDomains(
      [
        row({ citedUrls: ["https://www.acme.com/a", "https://rival.com/x", "not a url"] }),
        row({ citedUrls: ["https://blog.acme.com/", "https://rival.com/y", "https://wiki.org/"] }),
      ],
      "acme.com",
      ["rival.com"],
    );
    expect(rows).toEqual([
      { domain: "rival.com", count: 2, share: 40, kind: "competitor" },
      { domain: "acme.com", count: 1, share: 20, kind: "you" },
      { domain: "blog.acme.com", count: 1, share: 20, kind: "you" },
      { domain: "wiki.org", count: 1, share: 20, kind: "other" },
    ]);
    expect(citationDomains([], "acme.com", [])).toEqual([]);
    expect(hostOf("https://WWW.Example.com/Path")).toBe("example.com");
  });
});

describe("competitorComparison", () => {
  it("shows the brand next to each competitor, biggest first", () => {
    const result = competitorComparison(
      [
        row({ brandMentioned: true, competitorsMentioned: ["a.com"] }),
        row({ competitorsMentioned: ["a.com", "b.com"] }),
        row({}),
        row({ competitorsMentioned: ["b.com"] }),
      ],
      ["b.com", "a.com", "c.com"],
    );
    expect(result.total).toBe(4);
    expect(result.brand).toEqual({ answers: 1, rate: 25 });
    expect(result.rivals).toEqual([
      { domain: "a.com", answers: 2, rate: 50 },
      { domain: "b.com", answers: 2, rate: 50 },
      { domain: "c.com", answers: 0, rate: 0 },
    ]);
    expect(competitorComparison([], ["a.com"]).rivals[0]).toEqual({
      domain: "a.com",
      answers: 0,
      rate: 0,
    });
  });
});

describe("trendBy", () => {
  it("gives the mention rate per run for each engine, oldest first", () => {
    const trends = trendBy(
      [
        row({ engine: "chatgpt", checkedOn: "2026-03-08", brandMentioned: true }),
        row({ engine: "chatgpt", checkedOn: "2026-03-01", brandMentioned: false }),
        row({ engine: "chatgpt", checkedOn: "2026-03-08", brandMentioned: false }),
        row({ engine: "gemini", checkedOn: "2026-03-08", brandMentioned: true }),
      ],
      (c) => c.engine,
    );
    expect(trends).toEqual([
      {
        key: "chatgpt",
        points: [
          { date: "2026-03-01", rate: 0, total: 1 },
          { date: "2026-03-08", rate: 50, total: 2 },
        ],
        change: 50,
      },
      { key: "gemini", points: [{ date: "2026-03-08", rate: 100, total: 1 }], change: null },
    ]);
  });
});

describe("describeCoverage", () => {
  it("says how complete and fresh the run is and whether it is sample data", () => {
    const c = describeCoverage({
      prompts: 5,
      engines: 3,
      latestOn: "2026-03-08",
      latestCount: 12,
      today: "2026-03-10",
      sample: true,
    });
    expect(c).toMatchObject({ expected: 15, actual: 12, percent: 80, ageDays: 2, stale: false });
    expect(c.label).toBe("12 of 15 answers, checked 2 days ago, sample data");
  });
  it("flags old and missing runs", () => {
    const old = describeCoverage({
      prompts: 1,
      engines: 1,
      latestOn: "2026-02-01",
      latestCount: 1,
      today: "2026-03-10",
      sample: false,
    });
    expect(old.stale).toBe(true);
    expect(old.label).toBe("1 of 1 answers, checked 37 days ago, out of date, real data");
    const none = describeCoverage({
      prompts: 0,
      engines: 3,
      latestOn: null,
      latestCount: 0,
      today: "2026-03-10",
      sample: false,
    });
    expect(none).toMatchObject({ percent: 0, stale: true, label: "No check yet, real data" });
  });
});

describe("buildRecommendations", () => {
  const prompts = new Map([
    ["p1", "best dentist"],
    ["p2", "dentist prices"],
  ]);
  it("explains each tip with numbers and a confidence, most sure first", () => {
    const latest = [
      row({ promptId: "p1", engine: "chatgpt" }),
      row({ promptId: "p1", engine: "gemini" }),
      row({
        promptId: "p2",
        engine: "chatgpt",
        brandMentioned: true,
        domainCited: false,
        sentiment: "negative",
      }),
      row({ promptId: "p2", engine: "gemini", brandMentioned: true, sentiment: "negative" }),
      row({ promptId: "p2", engine: "perplexity", brandMentioned: true }),
    ];
    const recs = buildRecommendations({
      latest,
      promptText: prompts,
      rivals: [{ domain: "rival.com", answers: 4, rate: 80 }],
      brandAnswers: 3,
      topics: [{ topic: "dentist near me", aiSearchVolume: 900, changePercent: 40 }],
    });
    const ids = recs.map((r) => r.id);
    expect(ids).toContain("prompt-gap:p1");
    expect(ids).toContain("competitor-ahead:rival.com");
    expect(ids).toContain("mentioned-not-cited");
    expect(ids).toContain("negative-sentiment");
    expect(ids).toContain("rising-topic:dentist near me");
    const gap = recs.find((r) => r.id === "prompt-gap:p1")!;
    expect(gap.title).toBe('Get named for "best dentist"');
    expect(gap.evidence).toContain("not named in any of 2 answers");
    expect(recs.at(-1)!.confidence).toBe("low");
    expect(recs.find((r) => r.id.startsWith("rising"))!.evidence).toContain("vendor estimate");
  });

  it("finds a weak engine only when the gap is large", () => {
    const strong = Array.from({ length: 4 }, () =>
      row({ engine: "chatgpt", brandMentioned: true }),
    );
    const weak = Array.from({ length: 4 }, () => row({ engine: "gemini" }));
    const recs = buildRecommendations({
      latest: [...strong, ...weak],
      promptText: prompts,
      rivals: [],
      brandAnswers: 4,
      topics: [],
    });
    expect(recs.find((r) => r.id === "engine-gap:gemini")).toMatchObject({
      title: "Weak on Gemini",
      confidence: "medium",
    });
    const even = buildRecommendations({
      latest: [
        row({ engine: "chatgpt", brandMentioned: true }),
        row({ engine: "gemini", brandMentioned: true }),
      ],
      promptText: prompts,
      rivals: [],
      brandAnswers: 2,
      topics: [],
    });
    expect(even.some((r) => r.id.startsWith("engine-gap"))).toBe(false);
  });

  it("gives nothing without answers", () => {
    expect(
      buildRecommendations({
        latest: [],
        promptText: prompts,
        rivals: [],
        brandAnswers: 0,
        topics: [],
      }),
    ).toEqual([]);
  });
});
