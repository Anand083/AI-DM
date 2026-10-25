import { describe, expect, it } from "vitest";
import type { PlanLimits } from "./plan-limits";
import { formatPlanPrice, planFeatureLines, yearlySavingsPercent } from "./pricing";

const limits: PlanLimits = {
  maxClients: 5,
  maxProjects: 1,
  maxKeywords: 250,
  maxTeamMembers: 2,
  maxClientUsers: -1,
  auditPagesPerMonth: 2000,
  keywordResearchPerMonth: 0,
  liveChecksPerMonth: 0,
  aiChecksPerMonth: 0,
  backlinkQueriesPerMonth: 0,
  leadAuditsPerMonth: 0,
  reportSchedules: 5,
  customDomain: false,
  whiteLabel: true,
};

describe("pricing helpers", () => {
  it("formats prices", () => {
    expect(formatPlanPrice(14900)).toBe("$149");
    expect(formatPlanPrice(4950)).toBe("$49.50");
    expect(formatPlanPrice(0)).toBe("$0");
  });
  it("works out the yearly saving", () => {
    expect(yearlySavingsPercent(4900, 49000)).toBe(17);
    expect(yearlySavingsPercent(4900, 58800)).toBe(0);
    expect(yearlySavingsPercent(0, 100)).toBe(0);
  });
  it("describes limits in plain words", () => {
    const lines = planFeatureLines(limits);
    expect(lines).toContain("5 clients");
    expect(lines).toContain("1 website");
    expect(lines).toContain("Unlimited client logins");
    expect(lines).toContain("2,000 audit pages per month");
    expect(lines).toContain("5 scheduled reports");
    expect(lines).toContain("Your own name, logo and colors");
    expect(lines).not.toContain("Your own domain for the client portal");
    expect(planFeatureLines({ ...limits, customDomain: true, reportSchedules: 0 })).toEqual(
      expect.arrayContaining(["Your own domain for the client portal"]),
    );
  });
});
