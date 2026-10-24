export type SeverityCounts = { critical: number; warning: number; notice: number };

/**
 * Site health from 0 to 100 (plan Step 11):
 *   100 x (1 - min(1, (3 x critical + warning + 0.2 x notice) / (2 x pages)))
 * Critical problems count three times, notices one fifth. A site with 2 problems per page
 * (weighted) or more scores 0.
 */
export function healthScore(counts: SeverityCounts, pages: number): number {
  if (pages <= 0) return 0;
  const weighted = 3 * counts.critical + counts.warning + 0.2 * counts.notice;
  return Math.round(100 * (1 - Math.min(1, weighted / (2 * pages))));
}

export function countBySeverity(issues: { severity: string }[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, warning: 0, notice: 0 };
  for (const i of issues) {
    if (i.severity === "CRITICAL") counts.critical++;
    else if (i.severity === "WARNING") counts.warning++;
    else counts.notice++;
  }
  return counts;
}

export type IssueKey = { code: string; url: string };

export type IssueComparison = {
  /** In the earlier audit, gone now. */
  fixed: number;
  /** Not in the earlier audit, found now. */
  new: number;
  /** In both audits. */
  stillPresent: number;
  /** The same numbers for each issue code. */
  byCode: Record<string, { fixed: number; new: number; stillPresent: number }>;
};

const keyOf = (i: IssueKey) => `${i.code}\u0000${i.url}`;

/** Compares two audits. An issue is the same when the code and the page address are the same. */
export function compareIssues(previous: IssueKey[], current: IssueKey[]): IssueComparison {
  const before = new Set(previous.map(keyOf));
  const now = new Set(current.map(keyOf));
  const result: IssueComparison = { fixed: 0, new: 0, stillPresent: 0, byCode: {} };
  const bump = (code: string, field: "fixed" | "new" | "stillPresent") => {
    result[field]++;
    const entry = (result.byCode[code] ??= { fixed: 0, new: 0, stillPresent: 0 });
    entry[field]++;
  };
  for (const issue of current) {
    if (before.has(keyOf(issue))) bump(issue.code, "stillPresent");
    else bump(issue.code, "new");
  }
  for (const issue of previous) {
    if (!now.has(keyOf(issue))) bump(issue.code, "fixed");
  }
  return result;
}

/** Colour band for a score: good from 80, fair from 50. */
export function scoreBand(score: number): "good" | "fair" | "poor" {
  return score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
}
