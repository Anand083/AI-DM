/** Add whole months to a UTC date. Jan 31 + 1 month is Feb 28 (or 29), not March 3. */
export function addMonthsUtc(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export type UsagePeriod = { start: Date; end: Date };

/**
 * The monthly usage window that contains `now`, counted from `anchor` (the start of the
 * current billing period, or the trial start). Monthly plans have one window per billing period.
 * Yearly plans still reset every month, counted from the same day of the month.
 * `endCap` shortens the last window, for example to the day a trial ends.
 */
export function currentUsagePeriod(anchor: Date, now: Date, endCap?: Date | null): UsagePeriod {
  if (now < anchor) return { start: anchor, end: capEnd(addMonthsUtc(anchor, 1), endCap) };
  let n =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth());
  // The estimate can be one month too high when the day of the month has not been reached yet.
  while (n > 0 && addMonthsUtc(anchor, n) > now) n--;
  while (addMonthsUtc(anchor, n + 1) <= now) n++;
  return { start: addMonthsUtc(anchor, n), end: capEnd(addMonthsUtc(anchor, n + 1), endCap) };
}

function capEnd(end: Date, cap?: Date | null): Date {
  return cap && cap < end ? cap : end;
}

export type PeriodSubscription = {
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
};

export const TRIAL_LENGTH_DAYS = 14;

/** The usage period for a subscription (see `currentUsagePeriod`). */
export function subscriptionUsagePeriod(sub: PeriodSubscription, now: Date): UsagePeriod {
  if (sub.status === "TRIALING" && !sub.currentPeriodStart) {
    const trialStart = sub.trialEndsAt
      ? new Date(sub.trialEndsAt.getTime() - TRIAL_LENGTH_DAYS * 86_400_000)
      : sub.createdAt;
    return currentUsagePeriod(trialStart, now, sub.trialEndsAt);
  }
  return currentUsagePeriod(sub.currentPeriodStart ?? sub.createdAt, now);
}

/** First day (00:00 UTC) of the month that contains `date`, and the first day of the next month. */
export function calendarMonth(date: Date): UsagePeriod {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return { start, end: addMonthsUtc(start, 1) };
}
