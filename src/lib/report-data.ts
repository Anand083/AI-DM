import { rankChange } from "./rank-math";
import type { ReportKeywordRow } from "./report-model";

export type PeriodCheck = { date: string; position: number | null; rankingUrl: string | null };

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** A check this many days before the period start still counts as "the start". */
export const START_LOOKBACK_DAYS = 7;

/**
 * Works out where a keyword stood at the start and at the end of a period.
 * End: the latest check on or before the last day. Start: the latest check on or before the first
 * day (up to 7 days earlier), or else the first check inside the period when it is a different check
 * from the end one. Returns `checked: false` when there is no check up to the last day.
 */
export function pickPositions(
  checks: PeriodCheck[],
  period: { start: string; end: string },
): Pick<ReportKeywordRow, "position" | "startPosition" | "change" | "url" | "checked"> {
  const upToEnd = checks.filter((c) => c.date <= period.end);
  if (upToEnd.length === 0) {
    return { position: null, startPosition: null, change: null, url: null, checked: false };
  }
  const end = upToEnd.reduce((a, b) => (b.date > a.date ? b : a));
  const startDay = dayNumber(period.start);
  const before = upToEnd.filter(
    (c) => c.date <= period.start && dayNumber(c.date) >= startDay - START_LOOKBACK_DAYS,
  );
  let start: PeriodCheck | undefined = before.length
    ? before.reduce((a, b) => (b.date > a.date ? b : a))
    : undefined;
  if (!start) {
    const inside = upToEnd.filter((c) => c.date > period.start);
    const first = inside.length ? inside.reduce((a, b) => (b.date < a.date ? b : a)) : undefined;
    if (first && first.date !== end.date) start = first;
  }
  // One single check is not a comparison.
  if (start && start.date === end.date) start = undefined;
  return {
    position: end.position,
    startPosition: start ? start.position : null,
    change: start ? rankChange(start.position, end.position) : null,
    url: end.rankingUrl,
    checked: true,
  };
}
