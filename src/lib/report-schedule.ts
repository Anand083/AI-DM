export type ScheduleRule = {
  frequency: "WEEKLY" | "MONTHLY";
  /** 1 (Monday) to 7 (Sunday). */
  dayOfWeek: number;
  /** 1 to 28. */
  dayOfMonth: number;
  /** 0 to 23, in the agency time zone. */
  hour: number;
};

const DAY_MS = 86_400_000;

function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The UTC moment when the clock in `timeZone` shows `date` at `hour:00`.
 * If that time happens twice (clocks go back) the first one is used. If it does not exist
 * (clocks go forward) the first moment after the gap is used.
 */
export function zonedTimeToUtc(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d, hour);
  const candidates = new Set<number>();
  for (const shift of [-DAY_MS, DAY_MS]) {
    candidates.add(target - offsetMs(new Date(target + shift), timeZone));
  }
  const valid = [...candidates].filter((c) => c + offsetMs(new Date(c), timeZone) === target);
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(Math.max(...candidates));
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** ISO weekday of a calendar date: 1 is Monday, 7 is Sunday. */
export function isoWeekday(day: string): number {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The first run time strictly after `after`, for a rule, in the agency time zone. */
export function nextRunAt(rule: ScheduleRule, after: Date, timeZone: string): Date {
  const startDay = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(after);
  // The day before is included because the local day can start earlier than the UTC day.
  for (let i = -1; i <= 70; i++) {
    const day = addDays(startDay, i);
    const matches =
      rule.frequency === "WEEKLY"
        ? isoWeekday(day) === rule.dayOfWeek
        : Number(day.slice(8, 10)) === rule.dayOfMonth;
    if (!matches) continue;
    const at = zonedTimeToUtc(day, rule.hour, timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error("No run time found for the schedule.");
}

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function describeSchedule(rule: ScheduleRule): string {
  const hour = `${String(rule.hour).padStart(2, "0")}:00`;
  if (rule.frequency === "WEEKLY") return `Every ${WEEKDAYS[rule.dayOfWeek - 1]} at ${hour}`;
  return `On day ${rule.dayOfMonth} of every month at ${hour}`;
}
