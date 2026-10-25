import { describe, expect, it } from "vitest";
import { assembleReport, computeKpis } from "./report-assembler";
import type { ReportInput, ReportKeywordRow } from "./report-model";

const row = (
  phrase: string,
  position: number | null,
  startPosition: number | null,
  extra: Partial<ReportKeywordRow> = {},
): ReportKeywordRow => ({
  phrase,
  position,
  startPosition,
  change: null,
  url: null,
  checked: true,
  ...extra,
});

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  title: "March report",
  projectName: "Main site",
  clientName: "Acme",
  domain: "acme.test",
  period: { start: "2026-03-01", end: "2026-03-31", label: "1 Mar 2026 to 31 Mar 2026" },
  sections: [
    "summary",
    "distribution",
    "movers",
    "rankings",
    "audit",
    "issues",
    "opportunities",
    "notes",
  ],
  notes: "  Great month.  ",
  generatedOn: "2026-04-01",
  audit: null,
  keywords: [
    row("alpha", 2, 10),
    row("beta", 8, 4),
    row("gamma", 15, null),
    row("delta", null, 30),
    row("epsilon", 1, 1),
    row("zeta", null, null, { checked: false }),
  ],
  ...over,
});

describe("assembleReport", () => {
  it("computes key numbers", () => {
    const k = assembleReport(input()).kpis;
    expect(k).toMatchObject({
      tracked: 6,
      checked: 5,
      top3: 2,
      top10: 3,
      improved: 2,
      declined: 2,
    });
    // end positions 2, 8, 15, 1 average 6.5. start positions 10, 4, 30, 1 average 11.3
    expect(k.averagePosition).toBe(6.5);
    expect(k.averageChange).toBe(4.8);
  });

  it("builds the distribution with all buckets", () => {
    const d = assembleReport(input()).distribution;
    expect(d.map((b) => b.count)).toEqual([2, 1, 1, 0, 0, 1]);
    expect(d).toHaveLength(6);
  });

  it("orders movers by size of change", () => {
    const m = assembleReport(input()).movers;
    expect(m.up[0]).toMatchObject({ phrase: "gamma", change: 86 });
    expect(m.up[1]).toMatchObject({ phrase: "alpha", change: 8 });
    expect(m.down.map((r) => r.phrase)).toEqual(["delta", "beta"]);
    expect(m.down[0]!.change).toBe(-71);
  });

  it("does not list unchecked keywords as movers or in the distribution", () => {
    const model = assembleReport(input());
    expect([...model.movers.up, ...model.movers.down].some((r) => r.phrase === "zeta")).toBe(false);
    expect(model.distribution.reduce((s, b) => s + b.count, 0)).toBe(5);
  });

  it("sorts rankings by position with not ranking last", () => {
    expect(assembleReport(input()).rankings.map((r) => r.phrase)).toEqual([
      "epsilon",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "zeta",
    ]);
  });

  it("finds opportunities between position 4 and 20", () => {
    expect(assembleReport(input()).opportunities.map((r) => r.phrase)).toEqual(["beta", "gamma"]);
  });

  it("trims notes and turns blank notes into null", () => {
    expect(assembleReport(input()).notes).toBe("Great month.");
    expect(assembleReport(input({ notes: "   " })).notes).toBeNull();
  });

  it("sorts issues by severity, then pages, and limits them", () => {
    const issue = (code: string, severity: "CRITICAL" | "WARNING" | "NOTICE", pages: number) => ({
      code,
      title: code,
      severity,
      pages,
      fix: "Fix it.",
    });
    const model = assembleReport(
      input({
        audit: {
          finishedOn: "2026-03-30",
          healthScore: 80,
          pagesCrawled: 20,
          counts: { critical: 1, warning: 2, notice: 3 },
          previousScore: 70,
          issues: [
            issue("n1", "NOTICE", 9),
            issue("w1", "WARNING", 2),
            issue("c1", "CRITICAL", 1),
            issue("w2", "WARNING", 5),
          ],
        },
      }),
    );
    expect(model.issues.map((i) => i.code)).toEqual(["c1", "w2", "w1", "n1"]);
  });

  it("is deterministic", () => {
    expect(assembleReport(input())).toEqual(assembleReport(input()));
  });

  it("handles a project with no keywords", () => {
    const model = assembleReport(input({ keywords: [] }));
    expect(model.kpis).toMatchObject({
      tracked: 0,
      checked: 0,
      averagePosition: null,
      averageChange: null,
      visibility: 0,
    });
    expect(model.rankings).toEqual([]);
  });
});

describe("computeKpis", () => {
  it("has no average change when nothing was ranking at the start", () => {
    expect(computeKpis([row("a", 5, null)]).averageChange).toBeNull();
  });
});

describe("backlinks in the report", () => {
  it("is null when the loader gave none, and passed through when given", () => {
    expect(assembleReport(input()).backlinks).toBeNull();
    const backlinks = {
      checkedOn: "2026-03-30",
      totalBacklinks: 10,
      referringDomains: 4,
      domainRating: 30,
      dofollowPercent: 70,
      totalChange: null,
      domainsChange: null,
      newInPeriod: 0,
      lostInPeriod: 0,
      suspicious: 0,
      topNew: [],
      topLost: [],
    };
    expect(assembleReport(input({ backlinks })).backlinks).toEqual(backlinks);
  });
});

describe("competitors in the report", () => {
  it("is null when the loader gave none, and passed through when given", () => {
    expect(assembleReport(input()).competitors).toBeNull();
    const competitors = {
      compared: 2,
      competitors: [
        { domain: "rival.com", inTop10: 1, theyAreAhead: 1, youAreAhead: 1, averagePosition: 4 },
      ],
      gap: [{ keyword: "k", competitor: "rival.com", position: 3, volume: 100 }],
    };
    expect(assembleReport(input({ competitors })).competitors).toEqual(competitors);
  });
});
