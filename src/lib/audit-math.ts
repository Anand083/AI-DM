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

export type PageSnapshot = {
  url: string;
  statusCode: number;
  title: string | null;
  wordCount: number;
};

export type PageChanges = {
  /** Found now, not in the audit before. */
  added: string[];
  /** In the audit before, not found now. */
  removed: string[];
  statusChanged: { url: string; from: number; to: number }[];
  titleChanged: { url: string; from: string | null; to: string | null }[];
  /** Text length changed by 30% or more (and by at least 50 words). */
  contentChanged: { url: string; from: number; to: number }[];
};

const PAGE_CHANGE_CAP = 50;

/** What changed between two crawls of the same site, page by page. Each list shows at most 50. */
export function diffPages(
  before: readonly PageSnapshot[],
  after: readonly PageSnapshot[],
): PageChanges {
  const old = new Map(before.map((p) => [p.url, p]));
  const now = new Map(after.map((p) => [p.url, p]));
  const out: PageChanges = {
    added: [],
    removed: [],
    statusChanged: [],
    titleChanged: [],
    contentChanged: [],
  };
  for (const [url, page] of [...now].sort((a, b) => a[0].localeCompare(b[0]))) {
    const prev = old.get(url);
    if (!prev) {
      out.added.push(url);
      continue;
    }
    if (prev.statusCode !== page.statusCode) {
      out.statusChanged.push({ url, from: prev.statusCode, to: page.statusCode });
    }
    if ((prev.title ?? null) !== (page.title ?? null)) {
      out.titleChanged.push({ url, from: prev.title, to: page.title });
    }
    const diff = Math.abs(page.wordCount - prev.wordCount);
    if (diff >= 50 && diff >= 0.3 * Math.max(prev.wordCount, 1)) {
      out.contentChanged.push({ url, from: prev.wordCount, to: page.wordCount });
    }
  }
  for (const url of [...old.keys()].sort()) if (!now.has(url)) out.removed.push(url);
  for (const key of Object.keys(out) as (keyof PageChanges)[]) {
    out[key] = out[key].slice(0, PAGE_CHANGE_CAP) as never;
  }
  return out;
}

/** A Core Web Vitals reading as good, needs work or poor (Google's own limits). */
export function vitalRating(
  metric: "lcp" | "cls" | "inp",
  value: number | null | undefined,
): "good" | "needs work" | "poor" | null {
  if (value === null || value === undefined) return null;
  const [good, poor] = { lcp: [2500, 4000], cls: [100, 250], inp: [200, 500] }[metric];
  return value <= good ? "good" : value <= poor ? "needs work" : "poor";
}

export const formatVital = (metric: "lcp" | "cls" | "inp", value: number | null | undefined) =>
  value === null || value === undefined
    ? "-"
    : metric === "cls"
      ? (value / 1000).toFixed(2)
      : metric === "lcp"
        ? `${(value / 1000).toFixed(1)} s`
        : `${value} ms`;
