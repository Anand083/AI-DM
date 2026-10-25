import { describe, expect, it } from "vitest";
import { describeBacklinks } from "./report-backlinks";
import type { ReportBacklinksInput } from "./report-model";

const base: ReportBacklinksInput = {
  checkedOn: "2026-03-09",
  totalBacklinks: 1234,
  referringDomains: 210,
  domainRating: 41,
  dofollowPercent: 72,
  totalChange: 30,
  domainsChange: -5,
  newInPeriod: 12,
  lostInPeriod: 1,
  suspicious: 0,
  topNew: [],
  topLost: [],
};

describe("describeBacklinks", () => {
  it("writes the totals and the changes", () => {
    expect(describeBacklinks(base)).toEqual([
      "1,234 backlinks from 210 websites. Domain rating 41 out of 100. 72% of the links pass ranking value (dofollow). Checked on 2026-03-09.",
      "In this period 12 links were found and 1 link was lost. Total backlinks changed by +30 and referring websites by -5.",
    ]);
  });

  it("leaves out the change when there is no earlier check, and mentions suspicious links", () => {
    const lines = describeBacklinks({
      ...base,
      totalBacklinks: 1,
      referringDomains: 1,
      totalChange: null,
      domainsChange: null,
      suspicious: 3,
    });
    expect(lines[0]).toContain("1 backlink from 1 website.");
    expect(lines[1]).toBe("In this period 12 links were found and 1 link was lost.");
    expect(lines[2]).toBe("3 links look suspicious and should be reviewed.");
  });
});
