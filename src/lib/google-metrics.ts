const DAY_MS = 86_400_000;

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** Days in the range, both ends included. */
export const daysInRange = (start: string, end: string) => dayNumber(end) - dayNumber(start) + 1;

/** First load goes back this many days. */
export const BACKFILL_DAYS = 90;
/** Later loads start this many days before the last one, because Google still adjusts recent days. */
export const OVERLAP_DAYS = 5;
/** Search Console numbers for the last 2 days are not final yet. */
export const GSC_LAG_DAYS = 2;

/**
 * The date ranges one sync should read. Search Console stops 2 days ago (later days are not
 * final); Google Analytics stops yesterday (today is still counting).
 */
export function syncRanges(
  lastSyncedOn: string | null,
  today: string,
): { gsc: { start: string; end: string } | null; ga4: { start: string; end: string } | null } {
  const start = lastSyncedOn
    ? addDays(lastSyncedOn, -OVERLAP_DAYS)
    : addDays(today, -BACKFILL_DAYS);
  const gscEnd = addDays(today, -GSC_LAG_DAYS);
  const ga4End = addDays(today, -1);
  return {
    gsc: start <= gscEnd ? { start, end: gscEnd } : null,
    ga4: start <= ga4End ? { start, end: ga4End } : null,
  };
}

export type SearchDayRow = { clicks: number; impressions: number; positionTenths: number };

export type SearchTotals = {
  clicks: number;
  impressions: number;
  /** Clicks divided by impressions, in tenths of a percent (35 means 3.5%). */
  ctrTenthsPercent: number;
  /** Average position weighted by impressions, in tenths. Null without impressions. */
  positionTenths: number | null;
};

export function sumSearch(rows: readonly SearchDayRow[]): SearchTotals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weighted += r.positionTenths * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctrTenthsPercent: impressions === 0 ? 0 : Math.round((clicks / impressions) * 1000),
    positionTenths: impressions === 0 ? null : Math.round(weighted / impressions),
  };
}

export type AnalyticsDayRow = { sessions: number; conversions: number };

export function sumAnalytics(rows: readonly AnalyticsDayRow[]): AnalyticsDayRow {
  return rows.reduce(
    (t, r) => ({ sessions: t.sessions + r.sessions, conversions: t.conversions + r.conversions }),
    { sessions: 0, conversions: 0 },
  );
}

/** The period of the same length that ends the day before `start`. */
export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const length = daysInRange(start, end);
  return { start: addDays(start, -length), end: addDays(start, -1) };
}

/** Percent change from `before` to `now`, rounded. Null when there was nothing before. */
export function percentChange(now: number, before: number): number | null {
  return before === 0 ? null : Math.round(((now - before) / before) * 100);
}

export const formatTenthsPercent = (t: number) => `${(t / 10).toFixed(1)}%`;
export const formatPositionTenths = (t: number | null) => (t === null ? "-" : (t / 10).toFixed(1));
