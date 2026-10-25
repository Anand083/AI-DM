import type { ReportKpis, ReportSource } from "./report-model";

const signed = (n: number) => (n > 0 ? `up ${n}` : n < 0 ? `down ${Math.abs(n)}` : "no change");

/** Lines that compare this period with the one before. Empty when there is nothing to compare. */
export function describeComparison(
  now: ReportKpis,
  before: ReportKpis | null | undefined,
): string[] {
  if (!before || before.checked === 0) return [];
  const lines = [
    `Keywords in the top 10: ${now.top10} (${signed(now.top10 - before.top10)} on the period before).`,
    `Keywords in the top 3: ${now.top3} (${signed(now.top3 - before.top3)} on the period before).`,
    `Visibility score: ${now.visibility} (${signed(Math.round((now.visibility - before.visibility) * 10) / 10)} on the period before).`,
  ];
  if (now.averagePosition !== null && before.averagePosition !== null) {
    const diff = Math.round((before.averagePosition - now.averagePosition) * 10) / 10;
    lines.push(
      `Average position: ${now.averagePosition} (${diff > 0 ? `better by ${diff}` : diff < 0 ? `worse by ${Math.abs(diff)}` : "no change"} on the period before).`,
    );
  }
  return lines;
}

/** One line per data source: what it is, how fresh it is, and whether it is sample data. */
export function describeSource(s: ReportSource): string {
  const when = s.updated ? `updated ${s.updated}` : "no data yet";
  return `${s.label}: ${when}, ${s.real ? "real data" : "sample data"}`;
}

export const KIND_LABELS: Record<string, string> = {
  CAMPAIGN: "Campaign",
  ALGORITHM: "Google update",
  SITE_CHANGE: "Site change",
  OTHER: "Note",
};
