import { averagePosition, BUCKETS, distribution, rankChange, visibilityScore } from "./rank-math";
import {
  ISSUES_LIMIT,
  MOVERS_LIMIT,
  OPPORTUNITIES_LIMIT,
  RANKINGS_LIMIT,
  type ReportInput,
  type ReportKeywordRow,
  type ReportKpis,
  type ReportModel,
} from "./report-model";

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, NOTICE: 2 } as const;
const byPhrase = (a: ReportKeywordRow, b: ReportKeywordRow) => a.phrase.localeCompare(b.phrase);
const positionOrLast = (p: number | null) => p ?? 101;

export function computeKpis(rows: ReportKeywordRow[]): ReportKpis {
  const checked = rows.filter((r) => r.checked);
  const ends = checked.map((r) => r.position);
  const starts = checked.filter((r) => r.startPosition !== null).map((r) => r.startPosition);
  const avgEnd = averagePosition(ends);
  const avgStart = averagePosition(starts);
  return {
    tracked: rows.length,
    checked: checked.length,
    averagePosition: avgEnd,
    averageChange:
      avgEnd !== null && avgStart !== null ? Math.round((avgStart - avgEnd) * 10) / 10 : null,
    top3: ends.filter((p) => p !== null && p <= 3).length,
    top10: ends.filter((p) => p !== null && p <= 10).length,
    visibility: visibilityScore(ends),
    improved: checked.filter((r) => (r.change ?? 0) > 0).length,
    declined: checked.filter((r) => (r.change ?? 0) < 0).length,
  };
}

/** Fills in `change` from the start and end positions when the loader did not. */
function withChange(row: ReportKeywordRow): ReportKeywordRow {
  if (row.change !== null || !row.checked) return row;
  return { ...row, change: rankChange(row.startPosition, row.position) };
}

/**
 * Builds the report model from plain data. No database, no clock, no random: the same input
 * always gives the same output, so it is easy to test. The summary text is added later.
 */
export function assembleReport(input: ReportInput): Omit<ReportModel, "summary"> {
  const rows = input.keywords.map(withChange).sort(byPhrase);
  const checked = rows.filter((r) => r.checked);

  const moved = checked.filter((r) => r.change !== null && r.change !== 0);
  const up = moved
    .filter((r) => r.change! > 0)
    .sort((a, b) => b.change! - a.change! || byPhrase(a, b))
    .slice(0, MOVERS_LIMIT);
  const down = moved
    .filter((r) => r.change! < 0)
    .sort((a, b) => a.change! - b.change! || byPhrase(a, b))
    .slice(0, MOVERS_LIMIT);

  const counts = distribution(checked.map((r) => r.position));
  const opportunities = checked
    .filter((r) => r.position !== null && r.position >= 4 && r.position <= 20)
    .sort((a, b) => a.position! - b.position! || byPhrase(a, b))
    .slice(0, OPPORTUNITIES_LIMIT);

  const issues = [...(input.audit?.issues ?? [])]
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.pages - a.pages ||
        a.title.localeCompare(b.title),
    )
    .slice(0, ISSUES_LIMIT);

  return {
    version: 1,
    title: input.title,
    projectName: input.projectName,
    clientName: input.clientName,
    domain: input.domain,
    period: input.period,
    generatedOn: input.generatedOn,
    sections: input.sections,
    kpis: computeKpis(rows),
    distribution: BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts[b.key] })),
    movers: { up, down },
    rankings: [...rows]
      .sort((a, b) => positionOrLast(a.position) - positionOrLast(b.position) || byPhrase(a, b))
      .slice(0, RANKINGS_LIMIT),
    audit: input.audit,
    backlinks: input.backlinks ?? null,
    competitors: input.competitors ?? null,
    ai: input.ai ?? null,
    reviews: input.reviews ?? null,
    analytics: input.analytics ?? null,
    issues,
    opportunities,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
}
