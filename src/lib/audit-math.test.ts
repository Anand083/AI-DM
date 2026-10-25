import { describe, expect, it } from "vitest";
import {
  compareIssues,
  countBySeverity,
  diffPages,
  formatVital,
  healthScore,
  scoreBand,
  vitalRating,
} from "./audit-math";

describe("healthScore", () => {
  it("is 100 with no problems", () => {
    expect(healthScore({ critical: 0, warning: 0, notice: 0 }, 50)).toBe(100);
  });
  it("follows the plan's formula", () => {
    // weighted = 3*2 + 4 + 0.2*10 = 12; 100 * (1 - 12 / (2*50)) = 88
    expect(healthScore({ critical: 2, warning: 4, notice: 10 }, 50)).toBe(88);
    // weighted = 3*10 = 30 over 20 pages: 100 * (1 - 30/40) = 25
    expect(healthScore({ critical: 10, warning: 0, notice: 0 }, 20)).toBe(25);
  });
  it("counts critical problems three times and notices a fifth", () => {
    const base = { critical: 0, warning: 0, notice: 0 };
    const pages = 100;
    expect(healthScore({ ...base, critical: 10 }, pages)).toBe(85); // 30/200
    expect(healthScore({ ...base, warning: 30 }, pages)).toBe(85);
    expect(healthScore({ ...base, notice: 150 }, pages)).toBe(85);
  });
  it("never goes below 0", () => {
    expect(healthScore({ critical: 1000, warning: 0, notice: 0 }, 10)).toBe(0);
    expect(healthScore({ critical: 20, warning: 0, notice: 0 }, 10)).toBe(0); // exactly 3*20/(2*10) = 3, capped at 1
  });
  it("is 0 when no pages were crawled", () => {
    expect(healthScore({ critical: 0, warning: 0, notice: 0 }, 0)).toBe(0);
  });
  it("rounds", () => {
    // weighted 1 over 2*3 = 6: 100 * (1 - 1/6) = 83.33
    expect(healthScore({ critical: 0, warning: 1, notice: 0 }, 3)).toBe(83);
  });
});

describe("countBySeverity", () => {
  it("counts each severity", () => {
    expect(
      countBySeverity([
        { severity: "CRITICAL" },
        { severity: "WARNING" },
        { severity: "WARNING" },
        { severity: "NOTICE" },
      ]),
    ).toEqual({
      critical: 1,
      warning: 2,
      notice: 1,
    });
  });
});

describe("compareIssues", () => {
  const i = (code: string, url: string) => ({ code, url });
  it("finds fixed, new and still present issues", () => {
    const before = [i("missing_title", "/a"), i("missing_title", "/b"), i("slow_page", "/a")];
    const now = [i("missing_title", "/b"), i("slow_page", "/a"), i("broken_link_4xx", "/c")];
    const result = compareIssues(before, now);
    expect(result).toMatchObject({ fixed: 1, new: 1, stillPresent: 2 });
    expect(result.byCode).toEqual({
      missing_title: { fixed: 1, new: 0, stillPresent: 1 },
      slow_page: { fixed: 0, new: 0, stillPresent: 1 },
      broken_link_4xx: { fixed: 0, new: 1, stillPresent: 0 },
    });
  });
  it("treats the same code on a different page as a different issue", () => {
    const result = compareIssues([i("slow_page", "/a")], [i("slow_page", "/b")]);
    expect(result).toMatchObject({ fixed: 1, new: 1, stillPresent: 0 });
  });
  it("handles empty audits", () => {
    expect(compareIssues([], [])).toMatchObject({ fixed: 0, new: 0, stillPresent: 0 });
    expect(compareIssues([], [i("a", "/")])).toMatchObject({ new: 1 });
    expect(compareIssues([i("a", "/")], [])).toMatchObject({ fixed: 1 });
  });
});

describe("scoreBand", () => {
  it("has good, fair and poor bands", () => {
    expect(scoreBand(95)).toBe("good");
    expect(scoreBand(80)).toBe("good");
    expect(scoreBand(79)).toBe("fair");
    expect(scoreBand(50)).toBe("fair");
    expect(scoreBand(49)).toBe("poor");
  });
});

describe("diffPages", () => {
  const p = (url: string, statusCode = 200, title: string | null = "T", wordCount = 500) => ({
    url,
    statusCode,
    title,
    wordCount,
  });
  it("finds new, removed and changed pages", () => {
    const changes = diffPages(
      [p("/a"), p("/b"), p("/c", 200, "Old"), p("/d", 200, "T", 1000), p("/e")],
      [p("/a"), p("/c", 200, "New"), p("/d", 200, "T", 300), p("/e", 404), p("/f")],
    );
    expect(changes.added).toEqual(["/f"]);
    expect(changes.removed).toEqual(["/b"]);
    expect(changes.titleChanged).toEqual([{ url: "/c", from: "Old", to: "New" }]);
    expect(changes.contentChanged).toEqual([{ url: "/d", from: 1000, to: 300 }]);
    expect(changes.statusChanged).toEqual([{ url: "/e", from: 200, to: 404 }]);
  });
  it("ignores small text changes and caps each list", () => {
    expect(diffPages([p("/a", 200, "T", 100)], [p("/a", 200, "T", 140)]).contentChanged).toEqual(
      [],
    );
    const many = Array.from({ length: 80 }, (_, i) => p(`/p${String(i).padStart(2, "0")}`));
    expect(diffPages([], many).added).toHaveLength(50);
  });
});

describe("Core Web Vitals", () => {
  it("rates by Google's limits", () => {
    expect(vitalRating("lcp", 2400)).toBe("good");
    expect(vitalRating("lcp", 3000)).toBe("needs work");
    expect(vitalRating("lcp", 4001)).toBe("poor");
    expect(vitalRating("cls", 100)).toBe("good");
    expect(vitalRating("cls", 260)).toBe("poor");
    expect(vitalRating("inp", 500)).toBe("needs work");
    expect(vitalRating("inp", null)).toBeNull();
  });
  it("writes the numbers for people", () => {
    expect(formatVital("lcp", 2450)).toBe("2.5 s");
    expect(formatVital("cls", 60)).toBe("0.06");
    expect(formatVital("inp", 180)).toBe("180 ms");
    expect(formatVital("inp", undefined)).toBe("-");
  });
});
