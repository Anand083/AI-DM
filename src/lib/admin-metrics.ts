/** Money maths for the super admin overview. All money is in integer cents. */

export type PaidSubscription = {
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  interval: "MONTH" | "YEAR";
  priceMonthlyCents: number;
  priceYearlyCents: number;
};

/** What a subscription brings in per month. A yearly price is spread over 12 months. */
export function monthlyEquivalentCents(
  sub: Pick<PaidSubscription, "interval" | "priceMonthlyCents" | "priceYearlyCents">,
): number {
  return sub.interval === "YEAR" ? Math.round(sub.priceYearlyCents / 12) : sub.priceMonthlyCents;
}

/**
 * Monthly recurring revenue: active subscriptions and ones with a failed payment still in the grace
 * period. Trials, canceled and expired accounts bring in nothing.
 */
export function computeMrr(subs: PaidSubscription[]): number {
  return subs
    .filter((s) => s.status === "ACTIVE" || s.status === "PAST_DUE")
    .reduce((sum, s) => sum + monthlyEquivalentCents(s), 0);
}

/** Provider cost is stored in micro-dollars (1/1,000,000). Cents round to the nearest. */
export function microsToCents(micros: number): number {
  return Math.round(micros / 10_000);
}

/** Share of paying customers lost in a period, as a percent with one decimal. 0 when there was nobody to lose. */
export function churnPercent(lost: number, payingAtStart: number): number {
  if (payingAtStart <= 0) return 0;
  return Math.round((lost / payingAtStart) * 1000) / 10;
}

export type Margin = {
  revenueCents: number;
  costCents: number;
  marginCents: number;
  percent: number | null;
};

/** Revenue minus provider cost. The percent is null when there is no revenue to compare with. */
export function grossMargin(revenueCents: number, costCents: number): Margin {
  const marginCents = revenueCents - costCents;
  return {
    revenueCents,
    costCents,
    marginCents,
    percent: revenueCents > 0 ? Math.round((marginCents / revenueCents) * 1000) / 10 : null,
  };
}

const DAY_MS = 86_400_000;

/** The Monday (00:00 UTC) of the week containing `date`, as YYYY-MM-DD. */
export function weekStart(date: Date): string {
  const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - (day - 1) * DAY_MS,
  );
  return monday.toISOString().slice(0, 10);
}

/** Counts dates per week for the last `weeks` weeks, oldest first, including weeks with zero. */
export function countPerWeek(
  dates: Date[],
  now: Date,
  weeks: number,
): { week: string; count: number }[] {
  const current = Date.parse(`${weekStart(now)}T00:00:00Z`);
  const buckets = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) {
    buckets.set(new Date(current - i * 7 * DAY_MS).toISOString().slice(0, 10), 0);
  }
  for (const date of dates) {
    const key = weekStart(date);
    if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1);
  }
  return [...buckets].map(([week, count]) => ({ week, count }));
}

export const formatUsd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
