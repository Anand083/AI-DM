import { describe, expect, it } from "vitest";
import { compareIssues, countBySeverity, healthScore, scoreBand } from "./audit-math";

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
