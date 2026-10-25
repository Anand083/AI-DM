import { describe, expect, it } from "vitest";
import { describeAi } from "./report-ai";
import type { ReportAiInput } from "./report-model";

const base: ReportAiInput = {
  checkedOn: "2026-03-09",
  total: 12,
  mentionRate: 50,
  previousRate: 33,
  citedRate: 25,
  shareOfVoice: 60,
  averagePosition: 2,
  engines: [],
  prompts: [],
};

describe("describeAi", () => {
  it("writes the rates, the change and the share of voice", () => {
    expect(describeAi(base)).toEqual([
      "On 2026-03-09, AI assistants named the brand in 50% of 12 answers. This is up 17 points from the check before.",
      "The website was linked in 25% of the answers.",
      "Against the competitors named in the same answers, the brand has a 60% share of voice.",
    ]);
  });

  it("handles no earlier check, no change, a drop and no share of voice", () => {
    expect(describeAi({ ...base, previousRate: null, shareOfVoice: null })).toEqual([
      "On 2026-03-09, AI assistants named the brand in 50% of 12 answers.",
      "The website was linked in 25% of the answers.",
    ]);
    expect(describeAi({ ...base, previousRate: 50 })[0]).toContain("same as the check before");
    expect(describeAi({ ...base, previousRate: 80 })[0]).toContain("down 30 points");
  });
});
