/** A keyword that is not in the top 100 counts as position 101 when doing maths. */
export const NOT_RANKING = 101;

export function positionValue(position: number | null): number {
  return position ?? NOT_RANKING;
}

/**
 * How much a keyword moved. Positive means better (it went up the page).
 * 12 to 8 is +4. 8 to 12 is -4. Not ranking counts as 101.
 */
export function rankChange(previous: number | null, current: number | null): number {
  return positionValue(previous) - positionValue(current);
}

/** What to show in a table: "7", or "100+" when not in the top 100. */
export function formatPosition(position: number | null): string {
  return position === null ? "100+" : String(position);
}

/** "+4", "-2" or "0". Null (nothing to compare with) shows as a dash. */
export function formatChange(change: number | null): string {
  if (change === null) return "-";
  if (change > 0) return `+${change}`;
  return String(change);
}

/** Share of clicks a position gets, used for the visibility score. */
export function ctrWeight(position: number | null): number {
  if (position === null) return 0;
  if (position === 1) return 0.3;
  if (position === 2) return 0.15;
  if (position === 3) return 0.1;
  if (position === 4) return 0.07;
  if (position === 5) return 0.05;
  if (position <= 10) return 0.03;
  if (position <= 20) return 0.01;
  return 0;
}

/** Average click weight of all keywords times 100, with one decimal. 0 when there are no keywords. */
export function visibilityScore(positions: (number | null)[]): number {
  if (positions.length === 0) return 0;
  const total = positions.reduce<number>((sum, p) => sum + ctrWeight(p), 0);
  return Math.round((total / positions.length) * 1000) / 10;
}

export const BUCKETS = [
  { key: "top3", label: "1 to 3", min: 1, max: 3 },
  { key: "top10", label: "4 to 10", min: 4, max: 10 },
  { key: "top20", label: "11 to 20", min: 11, max: 20 },
  { key: "top50", label: "21 to 50", min: 21, max: 50 },
  { key: "top100", label: "51 to 100", min: 51, max: 100 },
  { key: "none", label: "Not ranking", min: NOT_RANKING, max: NOT_RANKING },
] as const;

export type BucketKey = (typeof BUCKETS)[number]["key"];

export function bucketOf(position: number | null): BucketKey {
  if (position === null) return "none";
  return BUCKETS.find((b) => position >= b.min && position <= b.max)?.key ?? "none";
}

export function distribution(positions: (number | null)[]): Record<BucketKey, number> {
  const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey, number>;
  for (const p of positions) counts[bucketOf(p)]++;
  return counts;
}

/** Average of the positions that rank. Null when nothing ranks. One decimal. */
export function averagePosition(positions: (number | null)[]): number | null {
  const ranking = positions.filter((p): p is number => p !== null);
  if (ranking.length === 0) return null;
  return Math.round((ranking.reduce((a, b) => a + b, 0) / ranking.length) * 10) / 10;
}

export type CheckPoint = {
  /** YYYY-MM-DD */
  date: string;
  position: number | null;
  rankingUrl: string | null;
  serpFeatures: string[];
};

export type KeywordSnapshot = {
  lastCheckedOn: string;
  currentPosition: number | null;
  currentUrl: string | null;
  currentFeatures: string[];
  bestPosition: number | null;
  changeDay: number | null;
  changeWeek: number | null;
  changeMonth: number | null;
};

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/**
 * The check to compare with: the most recent one on or before `days` days before the latest check,
 * but no more than 7 days further back (older than that is not a fair comparison).
 */
function referenceCheck(
  checks: CheckPoint[],
  latestDay: number,
  days: number,
): CheckPoint | undefined {
  const target = latestDay - days;
  let best: CheckPoint | undefined;
  for (const c of checks) {
    const d = dayNumber(c.date);
    if (d <= target && d >= target - 7 && (!best || d > dayNumber(best.date))) best = c;
  }
  return best;
}

/**
 * Builds the keyword snapshot from rank checks. `checks` should cover at least the last 37 days;
 * pass `bestEver` (lowest position in the whole history) so the best position is correct.
 */
export function buildSnapshot(
  checks: CheckPoint[],
  bestEver?: number | null,
): KeywordSnapshot | null {
  if (checks.length === 0) return null;
  const latest = checks.reduce((a, b) => (b.date > a.date ? b : a));
  const latestDay = dayNumber(latest.date);
  const changeFor = (days: number) => {
    const ref = referenceCheck(checks, latestDay, days);
    return ref ? rankChange(ref.position, latest.position) : null;
  };
  const positions = checks.map((c) => c.position).filter((p): p is number => p !== null);
  const bestInWindow = positions.length > 0 ? Math.min(...positions) : null;
  const best = [bestInWindow, bestEver ?? null].filter((p): p is number => p !== null);
  return {
    lastCheckedOn: latest.date,
    currentPosition: latest.position,
    currentUrl: latest.rankingUrl,
    currentFeatures: latest.serpFeatures,
    bestPosition: best.length > 0 ? Math.min(...best) : null,
    changeDay: changeFor(1),
    changeWeek: changeFor(7),
    changeMonth: changeFor(30),
  };
}
