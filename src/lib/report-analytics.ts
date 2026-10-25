import { formatPositionTenths, formatTenthsPercent } from "./google-metrics";
import type { ReportAnalyticsInput } from "./report-model";

const num = (n: number) => n.toLocaleString("en-US");
const versus = (change: number | null) =>
  change === null
    ? ""
    : ` (${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on the period before)`;

/** The lines of the Search Console and Analytics section as plain text, for the web view and the PDF. */
export function describeAnalytics(a: ReportAnalyticsInput): string[] {
  const lines: string[] = [];
  if (a.search) {
    lines.push(
      `Google Search showed the site ${num(a.search.impressions)} times${versus(a.search.impressionsChangePercent)} and people clicked ${num(a.search.clicks)} times${versus(a.search.clicksChangePercent)}. The click rate was ${formatTenthsPercent(a.search.ctrTenthsPercent)} and the average position was ${formatPositionTenths(a.search.positionTenths)}.`,
    );
  }
  if (a.analytics) {
    lines.push(
      `Google Analytics counted ${num(a.analytics.sessions)} sessions${versus(a.analytics.sessionsChangePercent)} and ${num(a.analytics.conversions)} conversions${versus(a.analytics.conversionsChangePercent)}.`,
    );
  }
  return lines;
}
