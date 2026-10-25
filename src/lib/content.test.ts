import { describe, expect, it } from "vitest";
import {
  compareBeforeAfter,
  contentFlags,
  detectDecay,
  freshness,
  suggestInternalLinks,
} from "./content";

describe("freshness", () => {
  it("buckets by age and copes with missing or future dates", () => {
    expect(freshness("2026-02-01", "2026-03-10")).toBe("fresh");
    expect(freshness("2025-09-01", "2026-03-10")).toBe("aging");
    expect(freshness("2024-01-01", "2026-03-10")).toBe("stale");
    expect(freshness(null, "2026-03-10")).toBe("unknown");
    expect(freshness("2026-04-01", "2026-03-10")).toBe("fresh");
    expect(freshness("2025-09-01T10:00:00Z", "2026-03-10")).toBe("aging");
  });
});

describe("detectDecay", () => {
  const t = (clicks: number, before: number | null) => ({
    clicks,
    impressions: 0,
    clicksBefore: before,
    impressionsBefore: null,
  });
  it("needs a real fall on a page with enough clicks before", () => {
    expect(detectDecay(t(60, 100))).toEqual({ percent: 40, lost: 40 });
    expect(detectDecay(t(0, 40))).toEqual({ percent: 100, lost: 40 });
    expect(detectDecay(t(75, 100))).toBeNull();
    expect(detectDecay(t(5, 20))).toBeNull();
    expect(detectDecay(t(50, null))).toBeNull();
    expect(detectDecay(t(150, 100))).toBeNull();
  });
});

describe("contentFlags", () => {
  it("lists the reasons in order", () => {
    expect(
      contentFlags({
        traffic: { clicks: 10, impressions: 0, clicksBefore: 100, impressionsBefore: null },
        freshness: "stale",
        thin: true,
        duplicate: true,
      }),
    ).toEqual(["decaying", "stale", "thin", "duplicate"]);
    expect(
      contentFlags({ traffic: null, freshness: "fresh", thin: false, duplicate: false }),
    ).toEqual([]);
  });
});

describe("suggestInternalLinks", () => {
  const page = (
    url: string,
    title: string,
    inlinks: number | null,
    keywords: string[] = [],
    growing = false,
  ) => ({
    url,
    title,
    inlinks,
    keywords,
    growing,
  });
  it("suggests linking from strong pages on the same topic to weak pages that could grow", () => {
    const found = suggestInternalLinks([
      page("/guide", "Dental implants guide", 20),
      page("/blog/costs", "What dental implants cost", 9),
      page("/about", "About our team", 30),
      page("/implants", "Implants", 1, ["dental implants"], true),
      page("/well-linked", "Whitening", 15, ["teeth whitening"], true),
    ]);
    expect(found).toEqual([
      {
        target: "/implants",
        inlinks: 1,
        keyword: "dental implants",
        from: [
          { url: "/guide", title: "Dental implants guide" },
          { url: "/blog/costs", title: "What dental implants cost" },
        ],
      },
    ]);
  });
  it("skips pages without link counts, without growth, or with nothing related", () => {
    expect(
      suggestInternalLinks([page("/a", "A", null, ["x y"], true), page("/b", "Other topic", 10)]),
    ).toEqual([]);
    expect(
      suggestInternalLinks([
        page("/a", "Whitening", 1, ["teeth whitening"], false),
        page("/b", "Teeth whitening", 10),
      ]),
    ).toEqual([]);
    expect(
      suggestInternalLinks([
        page("/a", "Whitening", 1, ["teeth whitening"], true),
        page("/b", "Unrelated page", 10),
      ]),
    ).toEqual([]);
  });
});

describe("compareBeforeAfter", () => {
  const baseline = { clicks: 100, impressions: 2000, positionTenths: 120 };
  it("waits 14 days", () => {
    expect(compareBeforeAfter(baseline, null, "2026-03-05", "2026-03-10")).toEqual({
      ready: false,
      daysSince: 5,
      daysLeft: 9,
    });
  });
  it("is partial before 28 days and complete after", () => {
    const now = { clicks: 150, impressions: 2500, positionTenths: 90 };
    expect(compareBeforeAfter(baseline, now, "2026-02-20", "2026-03-10")).toEqual({
      ready: true,
      daysSince: 18,
      partial: true,
      clicksChange: 50,
      impressionsChange: 25,
      positionChangeTenths: 30,
      verdict: "better",
    });
    expect(compareBeforeAfter(baseline, now, "2026-01-20", "2026-03-10")).toMatchObject({
      partial: false,
    });
  });
  it("calls a fall worse, a small move the same, and handles a page that vanished or had no clicks", () => {
    expect(
      compareBeforeAfter(
        baseline,
        { clicks: 70, impressions: 1, positionTenths: null },
        "2026-01-01",
        "2026-03-10",
      ),
    ).toMatchObject({ verdict: "worse", positionChangeTenths: null });
    expect(
      compareBeforeAfter(
        baseline,
        { clicks: 104, impressions: 1, positionTenths: 120 },
        "2026-01-01",
        "2026-03-10",
      ),
    ).toMatchObject({ verdict: "same" });
    expect(compareBeforeAfter(baseline, null, "2026-01-01", "2026-03-10")).toMatchObject({
      verdict: "worse",
      clicksChange: -100,
    });
    expect(
      compareBeforeAfter(
        { clicks: 0, impressions: 0, positionTenths: null },
        { clicks: 5, impressions: 9, positionTenths: 200 },
        "2026-01-01",
        "2026-03-10",
      ),
    ).toMatchObject({ verdict: "better", clicksChange: null });
  });
});
