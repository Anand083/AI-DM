export type ClientCostInput = {
  clientId: string;
  name: string;
  /** Monthly retainer already converted to base cents. Null when no retainer or no rate. */
  revenueCents: number | null;
  /** Provider spend this month in base cents. Null when the USD rate is missing. */
  providerCents: number | null;
  /** Minutes of finished tasks this month. */
  taskMinutes: number;
};

export type ClientProfit = {
  clientId: string;
  name: string;
  revenueCents: number | null;
  providerCents: number | null;
  timeCents: number;
  /** Null when revenue or provider cost is unknown. */
  marginCents: number | null;
  /** Percent of revenue, whole number. Null when the margin is unknown or revenue is zero. */
  marginPercent: number | null;
  /** Projected provider cost at the end of the month. */
  forecastProviderCents: number | null;
};

/** Cost of working time. `hourlyCents` is what an hour of team time costs the agency. */
export function timeCostCents(minutes: number, hourlyCents: number): number {
  return Math.round((minutes * hourlyCents) / 60);
}

/** Straight-line projection of a month-to-date total. `day` is 1-based. */
export function forecastMonth(spent: number, day: number, daysInMonth: number): number {
  if (day <= 0 || daysInMonth <= 0) return spent;
  return Math.round((spent / Math.min(day, daysInMonth)) * daysInMonth);
}

export function daysInUtcMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

export function computeProfit(
  row: ClientCostInput,
  hourlyCents: number,
  day: number,
  daysInMonth: number,
): ClientProfit {
  const timeCents = timeCostCents(row.taskMinutes, hourlyCents);
  const known = row.revenueCents !== null && row.providerCents !== null;
  const margin = known ? row.revenueCents! - row.providerCents! - timeCents : null;
  return {
    clientId: row.clientId,
    name: row.name,
    revenueCents: row.revenueCents,
    providerCents: row.providerCents,
    timeCents,
    marginCents: margin,
    marginPercent:
      margin !== null && row.revenueCents! > 0
        ? Math.round((margin / row.revenueCents!) * 100)
        : null,
    forecastProviderCents:
      row.providerCents === null ? null : forecastMonth(row.providerCents, day, daysInMonth),
  };
}

export type ProfitTotals = {
  revenueCents: number;
  providerCents: number;
  timeCents: number;
  marginCents: number;
  forecastProviderCents: number;
  /** Clients left out because a retainer or a rate is missing. */
  skipped: number;
};

export function totalProfit(rows: ClientProfit[]): ProfitTotals {
  const t: ProfitTotals = {
    revenueCents: 0,
    providerCents: 0,
    timeCents: 0,
    marginCents: 0,
    forecastProviderCents: 0,
    skipped: 0,
  };
  for (const r of rows) {
    if (r.marginCents === null) {
      t.skipped++;
      continue;
    }
    t.revenueCents += r.revenueCents!;
    t.providerCents += r.providerCents!;
    t.timeCents += r.timeCents;
    t.marginCents += r.marginCents;
    t.forecastProviderCents += r.forecastProviderCents ?? 0;
  }
  return t;
}
