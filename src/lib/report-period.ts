import { localParts } from "./local-time";

export type PeriodKind = "last7" | "last30" | "lastMonth" | "custom";

export const PERIOD_OPTIONS: { kind: PeriodKind; label: string }[] = [
  { kind: "last7", label: "Last 7 days" },
  { kind: "last30", label: "Last 30 days" },
  { kind: "lastMonth", label: "Last month" },
  { kind: "custom", label: "Custom dates" },
];

export type ResolvedPeriod = { start: string; end: string; label: string };

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;

const parse = (day: string) => new Date(`${day}T00:00:00Z`);
const format = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => format(new Date(parse(day).getTime() + n * DAY_MS));

/** "10 Mar 2026" */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parse(day));
}

export function periodLabel(start: string, end: string): string {
  return `${formatDay(start)} to ${formatDay(end)}`;
}

export class PeriodError extends Error {}

/**
 * Turns a choice like "last 30 days" into real dates. "Today" is the date in the agency's time
 * zone. Last 7 or 30 days end today (and include it). Last month is the whole previous calendar month.
 */
export function resolvePeriod(
  input: { kind: PeriodKind; start?: string; end?: string },
  options: { now: Date; timeZone: string },
): ResolvedPeriod {
  const today = localParts(options.now, options.timeZone).date;
  let start: string;
  let end: string;
  switch (input.kind) {
    case "last7":
      end = today;
      start = addDays(today, -6);
      break;
    case "last30":
      end = today;
      start = addDays(today, -29);
      break;
    case "lastMonth": {
      const first = parse(`${today.slice(0, 7)}-01`);
      const lastOfPrevious = new Date(first.getTime() - DAY_MS);
      end = format(lastOfPrevious);
      start = `${end.slice(0, 7)}-01`;
      break;
    }
    case "custom": {
      if (
        !input.start ||
        !input.end ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.start) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.end)
      ) {
        throw new PeriodError("Choose a start date and an end date.");
      }
      if (Number.isNaN(parse(input.start).getTime()) || Number.isNaN(parse(input.end).getTime())) {
        throw new PeriodError("Choose real dates.");
      }
      start = input.start;
      end = input.end;
      break;
    }
  }
  if (start > end) throw new PeriodError("The start date must be before the end date.");
  if (end > today) throw new PeriodError("The end date cannot be in the future.");
  if ((parse(end).getTime() - parse(start).getTime()) / DAY_MS + 1 > MAX_DAYS) {
    throw new PeriodError("A report can cover up to one year.");
  }
  return { start, end, label: periodLabel(start, end) };
}
