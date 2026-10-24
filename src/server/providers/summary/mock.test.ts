import { describe, expect, it } from "vitest";
import { assembleReport } from "@/lib/report-assembler";
import type { ReportInput } from "@/lib/report-model";
import { buildSummary } from "./mock";

const base: ReportInput = {
  title: "T",
  projectName: "P",
  clientName: "C",
  domain: "acme.test",
  period: { start: "2026-03-01", end: "2026-03-31", label: "1 Mar 2026 to 31 Mar 2026" },
  sections: ["summary"],
  notes: null,
  generatedOn: "2026-04-01",
  audit: null,
  keywords: [
    { phrase: "a", position: 2, startPosition: 10, change: null, url: null, checked: true },
    { phrase: "b", position: 8, startPosition: 4, change: null, url: null, checked: true },
  ],
};

describe("buildSummary", () => {
  it("describes rankings and the biggest gain", () => {
    const text = buildSummary(assembleReport(base));
    expect(text).toContain("we checked 2 keywords for acme.test");
    expect(text).toContain("1 keyword is in the top 3 and 2 are on the first page");
    expect(text).toContain("1 keyword moved up and 1 keyword moved down");
    expect(text).toContain('"a", up 8 places to 2');
  });

  it("mentions the site check and its trend", () => {
    const audit = {
      finishedOn: "2026-03-30",
      healthScore: 80,
      pagesCrawled: 1,
      counts: { critical: 0, warning: 1, notice: 1 },
      previousScore: 70,
      issues: [],
    };
    const text = buildSummary(assembleReport({ ...base, audit }));
    expect(text).toContain("scored 80 out of 100 across 1 page, with 2 issues");
    expect(text).toContain("up from 70");
  });

  it("handles a project that was never checked", () => {
    const text = buildSummary(assembleReport({ ...base, keywords: [] }));
    expect(text).toContain("none have been checked yet");
  });

  it("never contains an em dash and gives the same text twice", () => {
    const model = assembleReport(base);
    expect(buildSummary(model)).toBe(buildSummary(model));
    expect(buildSummary(model)).not.toContain("—");
  });
});
