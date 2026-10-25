import { normalizeDomain } from "./domain";

/** The most competitors one project can have. */
export const MAX_COMPETITORS = 5;

export type TopResult = { position: number; domain: string };

const sameSite = (a: string, b: string) => (normalizeDomain(a) ?? a.toLowerCase()) === b;

/**
 * Where a domain stands in the stored top 10 of a search. Null when it is not in the top 10.
 * `domain` must already be normalised (lower case, no "www.").
 */
export function positionInTop(results: readonly TopResult[], domain: string): number | null {
  let best: number | null = null;
  for (const r of results) {
    if (!sameSite(r.domain, domain)) continue;
    if (best === null || r.position < best) best = r.position;
  }
  return best;
}

/** Position used for sorting and comparing. Not in the top 10 counts as worse than 10. */
const rank = (position: number | null) => position ?? 11;

export type ComparisonRow = {
  phrase: string;
  /** The project's position (1 to 100), or null when it is not in the top 100. */
  you: number | null;
  /** Each competitor's position inside the top 10, by domain. */
  competitors: Record<string, number | null>;
};

export type CompetitorSummary = {
  domain: string;
  /** Keywords where the competitor is in the top 10. */
  inTop10: number;
  /** Keywords where the competitor is above you (and in the top 10). */
  theyAreAhead: number;
  /** Keywords where you are above the competitor, or the competitor is not in the top 10. */
  youAreAhead: number;
  /** Average position over the keywords where the competitor is in the top 10. */
  averagePosition: number | null;
};

/** One summary per competitor over all compared keywords. */
export function summarizeCompetitors(
  rows: readonly ComparisonRow[],
  domains: readonly string[],
): CompetitorSummary[] {
  return domains.map((domain) => {
    let inTop10 = 0;
    let theyAreAhead = 0;
    let youAreAhead = 0;
    let sum = 0;
    for (const row of rows) {
      const them = row.competitors[domain] ?? null;
      if (them === null) {
        youAreAhead++;
        continue;
      }
      inTop10++;
      sum += them;
      // Ties go to the competitor only when you are not in the top 10 at all.
      if (row.you === null || them < row.you) theyAreAhead++;
      else youAreAhead++;
    }
    return {
      domain,
      inTop10,
      theyAreAhead,
      youAreAhead,
      averagePosition: inTop10 === 0 ? null : Math.round((sum / inTop10) * 10) / 10,
    };
  });
}

/** Rows where a competitor is above you come first, then by the best competitor position. */
export function sortComparison(rows: readonly ComparisonRow[]): ComparisonRow[] {
  const best = (row: ComparisonRow) => Math.min(...Object.values(row.competitors).map(rank), 11);
  // A competitor outside the top 10 never counts as being above you.
  const behind = (row: ComparisonRow) => (best(row) <= 10 && best(row) < (row.you ?? 101) ? 0 : 1);
  return [...rows].sort(
    (a, b) => behind(a) - behind(b) || best(a) - best(b) || a.phrase.localeCompare(b.phrase),
  );
}

export type GapCandidate = {
  keyword: string;
  position: number;
  volume: number;
  url: string | null;
};

/**
 * Keywords a competitor ranks for that the project neither ranks for nor tracks, biggest volume first.
 * Both sets hold lower case keywords.
 */
export function findGap(
  competitorKeywords: readonly GapCandidate[],
  ownRanked: ReadonlySet<string>,
  tracked: ReadonlySet<string>,
  limit: number,
): GapCandidate[] {
  const seen = new Set<string>();
  const gap: GapCandidate[] = [];
  for (const row of competitorKeywords) {
    const key = row.keyword.trim().toLowerCase();
    if (!key || seen.has(key) || ownRanked.has(key) || tracked.has(key)) continue;
    seen.add(key);
    gap.push({ ...row, keyword: key });
  }
  return gap
    .sort(
      (a, b) =>
        b.volume - a.volume || a.position - b.position || a.keyword.localeCompare(b.keyword),
    )
    .slice(0, limit);
}
