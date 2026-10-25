import { addDays } from "./google-metrics";

export const GOAL_KINDS = [
  {
    key: "TOP10_KEYWORDS",
    label: "Keywords in the top 10",
    unit: "keywords",
    lowerIsBetter: false,
    hint: "How many tracked keywords rank in the top 10.",
  },
  {
    key: "AVG_POSITION",
    label: "Average position",
    unit: "position",
    lowerIsBetter: true,
    hint: "The average position of the tracked keywords. Lower is better.",
  },
  {
    key: "HEALTH_SCORE",
    label: "Site health score",
    unit: "points",
    lowerIsBetter: false,
    hint: "The score of the latest site audit, 0 to 100.",
  },
  {
    key: "CLICKS_28D",
    label: "Search clicks in 28 days",
    unit: "clicks",
    lowerIsBetter: false,
    hint: "Clicks from Google Search in the last 28 days (needs Search Console).",
  },
  {
    key: "SESSIONS_28D",
    label: "Sessions in 28 days",
    unit: "sessions",
    lowerIsBetter: false,
    hint: "Visits in the last 28 days (needs Google Analytics).",
  },
  {
    key: "REVIEW_RATING",
    label: "Average review rating",
    unit: "stars",
    lowerIsBetter: false,
    hint: "The rating of the linked business (needs review tracking).",
  },
] as const;
export type GoalKind = (typeof GOAL_KINDS)[number]["key"];

export const goalInfo = (kind: string) => GOAL_KINDS.find((k) => k.key === kind);

/** Position and star goals are stored in tenths (65 means 6.5). */
const TENTHS: readonly string[] = ["AVG_POSITION", "REVIEW_RATING"];
export const usesTenths = (kind: string) => TENTHS.includes(kind);

/** What a person types (6.5) to what is stored (65). */
export const toStored = (kind: string, typed: number) =>
  usesTenths(kind) ? Math.round(typed * 10) : Math.round(typed);
/** What is stored (65) to what is shown ("6.5"). */
export const formatGoalValue = (kind: string, stored: number | null) =>
  stored === null
    ? "-"
    : usesTenths(kind)
      ? (stored / 10).toFixed(1)
      : stored.toLocaleString("en-US");

/**
 * Share of the way from the start value to the target, in whole percent between 0 and 100.
 * With no start value (or a start already at the target) it is 100 once the target is reached, else 0.
 */
export function goalPercent(
  kind: string,
  start: number | null,
  current: number | null,
  target: number,
): number {
  if (current === null) return 0;
  const lower = goalInfo(kind)?.lowerIsBetter ?? false;
  const reached = lower ? current <= target : current >= target;
  if (reached) return 100;
  if (start === null || start === target) return 0;
  const total = lower ? start - target : target - start;
  const done = lower ? start - current : current - start;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(99, Math.round((done / total) * 100)));
}

export type GoalPointValue = { on: string; value: number };

export type Forecast = {
  /** Estimated value on the due day. */
  atDue: number | null;
  /** First day the target is estimated to be reached, if the trend gets there. */
  reachedOn: string | null;
  /** Change per day of the trend. */
  perDay: number;
};

/**
 * A straight-line estimate from the saved daily points (the last 30 are used). It is a rough
 * guide, not a promise, and needs at least 5 points over at least 5 days.
 */
export function forecastGoal(
  kind: string,
  points: readonly GoalPointValue[],
  target: number,
  dueOn: string | null,
): Forecast | null {
  const recent = [...points].sort((a, b) => a.on.localeCompare(b.on)).slice(-30);
  if (recent.length < 5) return null;
  const t0 = Date.parse(`${recent[0]!.on}T00:00:00Z`) / 86_400_000;
  const xs = recent.map((p) => Date.parse(`${p.on}T00:00:00Z`) / 86_400_000 - t0);
  if (xs[xs.length - 1]! < 5) return null;
  const n = recent.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = recent.reduce((a, p) => a + p.value, 0) / n;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - meanX) * (recent[i]!.value - meanY);
    den += (x - meanX) ** 2;
  });
  if (den === 0) return null;
  const slope = num / den;
  const at = (day: number) => meanY + slope * (day - meanX);
  const lastDay = xs[xs.length - 1]!;
  const lower = goalInfo(kind)?.lowerIsBetter ?? false;
  const dueX = dueOn ? Date.parse(`${dueOn}T00:00:00Z`) / 86_400_000 - t0 : null;
  let reachedOn: string | null = null;
  const moving = lower ? slope < 0 : slope > 0;
  if (moving) {
    const days = Math.ceil((target - at(lastDay)) / slope);
    if (days >= 0 && days < 3650) reachedOn = addDays(recent[recent.length - 1]!.on, days);
  }
  return {
    atDue: dueX === null ? null : Math.round(at(dueX)),
    reachedOn,
    perDay: Math.round(slope * 100) / 100,
  };
}

/** Whether the estimate says the target is met by the due day. Null when we cannot say. */
export function onTrack(
  kind: string,
  f: Forecast | null,
  target: number,
  dueOn: string | null,
): boolean | null {
  if (!f || !dueOn || f.atDue === null) return null;
  return goalInfo(kind)?.lowerIsBetter ? f.atDue <= target : f.atDue >= target;
}

/** A short plain-English status for a goal. Estimates are labelled as estimates. */
export function goalStatus(percent: number, track: boolean | null): string {
  if (percent >= 100) return "Target reached";
  if (track === true) return "On track for the due date (estimate)";
  if (track === false) return "Behind the pace needed (estimate)";
  return "No estimate yet";
}
