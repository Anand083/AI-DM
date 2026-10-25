/** Currencies an agency can bill in. Rates are typed in by the agency (we never call a rates service). */
export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "INR",
  "SGD",
  "AED",
  "ZAR",
] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (v: string): v is Currency =>
  (CURRENCIES as readonly string[]).includes(v);

/** One rate: how many micro-units of the base currency buy 1 unit of `currency` (1.08 = 1,080,000). */
export type RateMap = Partial<Record<string, number>>;

export const RATE_ONE = 1_000_000;

/** Turns "1.08" into 1080000. Returns null for anything that is not a positive number. */
export function parseRate(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(t)) return null;
  const micros = Math.round(Number(t) * RATE_ONE);
  return micros > 0 && micros <= 1_000_000 * 1_000_000 ? micros : null;
}

export function formatRate(micros: number): string {
  return (micros / RATE_ONE).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** Converts cents of `from` into cents of the base currency. Null when the rate is missing. */
export function toBaseCents(
  cents: number,
  from: string,
  base: string,
  rates: RateMap,
): number | null {
  if (from === base) return cents;
  const rate = rates[from];
  if (!rate) return null;
  return Math.round((cents * rate) / RATE_ONE);
}

/** Provider cost (micro-dollars) into cents of the base currency. Null when the USD rate is missing. */
export function microsToBaseCents(micros: number, base: string, rates: RateMap): number | null {
  return toBaseCents(Math.round(micros / 10_000), "USD", base, rates);
}

export function formatMoney(cents: number, currency: string): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return `${sign}${text} ${currency}`;
}
