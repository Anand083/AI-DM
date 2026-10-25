import { describe, expect, it } from "vitest";
import { describeAnalytics } from "./report-analytics";

describe("describeAnalytics", () => {
  it("writes search and analytics lines with the change against the period before", () => {
    const lines = describeAnalytics({
      search: {
        clicks: 1200,
        impressions: 30000,
        ctrTenthsPercent: 40,
        positionTenths: 83,
        clicksChangePercent: 12,
        impressionsChangePercent: -5,
      },
      analytics: {
        sessions: 4000,
        conversions: 80,
        sessionsChangePercent: null,
        conversionsChangePercent: 0,
      },
    });
    expect(lines).toEqual([
      "Google Search showed the site 30,000 times (down 5% on the period before) and people clicked 1,200 times (up 12% on the period before). The click rate was 4.0% and the average position was 8.3.",
      "Google Analytics counted 4,000 sessions and 80 conversions (up 0% on the period before).",
    ]);
  });

  it("skips a part that has no data", () => {
    expect(describeAnalytics({ search: null, analytics: null })).toEqual([]);
    const only = describeAnalytics({
      search: null,
      analytics: {
        sessions: 1,
        conversions: 0,
        sessionsChangePercent: null,
        conversionsChangePercent: null,
      },
    });
    expect(only).toEqual(["Google Analytics counted 1 sessions and 0 conversions."]);
  });
});
