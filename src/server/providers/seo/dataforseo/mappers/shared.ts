/** Small helpers for reading vendor JSON without trusting its shape. */
export type Json = Record<string, unknown>;

export const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export const int = (v: unknown, fallback = 0): number => {
  const n = num(v);
  return n === null ? fallback : Math.round(n);
};

/** True when `host` is `domain` or a subdomain of it. */
export function sameSite(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

/** Vendor rank scores run from 0 to 1000. Our ratings run from 0 to 100. */
export const rating = (rank: unknown): number =>
  Math.max(0, Math.min(100, Math.round((num(rank) ?? 0) / 10)));

/** Dates come as "2026-03-04 12:00:00 +00:00" or ISO text. Returns ISO text or null. */
export function isoDate(v: unknown): string | null {
  const t = str(v);
  if (!t) return null;
  const d = new Date(t.replace(" +00:00", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
