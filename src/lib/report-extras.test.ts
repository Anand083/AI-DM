import { describe, expect, it } from "vitest";
import { describeComparison, describeSource } from "./report-extras";
import type { ReportKpis } from "./report-model";

const kpis = (o: Partial<ReportKpis>): ReportKpis => ({
  tracked: 10,
  checked: 10,
  averagePosition: 10,
  averageChange: null,
  top3: 2,
  top10: 5,
  visibility: 30,
  improved: 0,
  declined: 0,
  ...o,
});

describe("describeComparison", () => {
  it("compares with the period before", () => {
    const lines = describeComparison(
      kpis({ top10: 8, top3: 1, visibility: 35, averagePosition: 8 }),
      kpis({}),
    );
    expect(lines[0]).toBe("Keywords in the top 10: 8 (up 3 on the period before).");
    expect(lines[1]).toContain("down 1");
    expect(lines[2]).toContain("up 5");
    expect(lines[3]).toBe("Average position: 8 (better by 2 on the period before).");
  });

  it("says nothing without a usable earlier period", () => {
    expect(describeComparison(kpis({}), null)).toEqual([]);
    expect(describeComparison(kpis({}), kpis({ checked: 0 }))).toEqual([]);
  });

  it("handles a worse and an equal position", () => {
    expect(describeComparison(kpis({ averagePosition: 12 }), kpis({}))[3]).toContain("worse by 2");
    expect(describeComparison(kpis({}), kpis({}))[3]).toContain("no change");
  });
});

describe("describeSource", () => {
  it("shows freshness and the sample flag", () => {
    expect(describeSource({ label: "Rankings", updated: "2026-03-01", real: false })).toBe(
      "Rankings: updated 2026-03-01, sample data",
    );
    expect(describeSource({ label: "Audit", updated: null, real: true })).toBe(
      "Audit: no data yet, real data",
    );
  });
});
