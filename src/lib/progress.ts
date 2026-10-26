import { averagePosition, positionValue, visibilityScore } from "./rank-math";

/** One keyword: where it ranked at its first check and where it ranks now. */
export type KeywordProgressInput = {
  firstDate: string;
  firstPosition: number | null;
  currentDate: string;
  currentPosition: number | null;
};

export type Progress = {
  /** Day of the earliest check of any keyword, YYYY-MM-DD. Null when nothing was checked. */
  since: string | null;
  /** Keywords with at least two checks on different days. Only these are compared. */
  compared: number;
  /** Keywords with too few checks to compare yet. */
  waiting: number;
  up: number;
  down: number;
  same: number;
  pageOneStart: number;
  pageOneNow: number;
  averageStart: number | null;
  averageNow: number | null;
  visibilityStart: number;
  visibilityNow: number;
  /** better, worse, same or none (not enough checks). */
  verdict: "better" | "worse" | "same" | "none";
};

/**
 * Compares each keyword's first check with its latest. A keyword that is not in the top 100
 * counts as 101. The verdict is simple on purpose: keywords up minus keywords down, plus twice
 * the change in keywords on page one. Above zero is better, below zero is worse.
 */
export function buildProgress(rows: KeywordProgressInput[]): Progress {
  const since = rows.reduce<string | null>(
    (min, r) => (min === null || r.firstDate < min ? r.firstDate : min),
    null,
  );
  const usable = rows.filter((r) => r.firstDate < r.currentDate);
  const start = usable.map((r) => r.firstPosition);
  const now = usable.map((r) => r.currentPosition);
  let up = 0;
  let down = 0;
  for (const r of usable) {
    const diff = positionValue(r.firstPosition) - positionValue(r.currentPosition);
    if (diff > 0) up++;
    else if (diff < 0) down++;
  }
  const pageOneStart = start.filter((p) => p !== null && p <= 10).length;
  const pageOneNow = now.filter((p) => p !== null && p <= 10).length;
  const score = up - down + 2 * (pageOneNow - pageOneStart);
  return {
    since,
    compared: usable.length,
    waiting: rows.length - usable.length,
    up,
    down,
    same: usable.length - up - down,
    pageOneStart,
    pageOneNow,
    averageStart: averagePosition(start),
    averageNow: averagePosition(now),
    visibilityStart: visibilityScore(start),
    visibilityNow: visibilityScore(now),
    verdict: usable.length === 0 ? "none" : score > 0 ? "better" : score < 0 ? "worse" : "same",
  };
}

/** One plain sentence for the top of a page or a report. */
export function progressSentence(p: Progress): string {
  if (p.verdict === "none")
    return p.since
      ? "Tracking has started. We need a second check on a later day before we can show progress."
      : "No keywords have been checked yet.";
  const move =
    p.verdict === "better"
      ? "Overall ranking is better"
      : p.verdict === "worse"
        ? "Overall ranking is worse"
        : "Overall ranking is about the same";
  return `${move} than at the start. ${p.up} up, ${p.down} down, ${p.same} unchanged. ${p.pageOneNow} on page one now, ${p.pageOneStart} at the start.`;
}
