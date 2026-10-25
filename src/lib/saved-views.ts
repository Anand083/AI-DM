/** Lists that can save their filters, and the filter keys each one allows. */
export const VIEW_SCOPES = {
  clients: ["q", "status"],
  tasks: ["view", "q"],
} as const;
export type ViewScope = keyof typeof VIEW_SCOPES;

export const isViewScope = (v: string): v is ViewScope => v in VIEW_SCOPES;

const MAX_VALUE = 100;

/** Keeps only the allowed keys with short, non-empty text values. */
export function cleanViewParams(scope: ViewScope, raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const key of VIEW_SCOPES[scope]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v.trim().slice(0, MAX_VALUE);
  }
  return out;
}

/** The address of a saved view: the list path plus its filters. */
export function viewHref(base: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${base}?${query}` : base;
}

/** Dashboard parts a person can hide. */
export const DASHBOARD_PARTS = ["stats", "clients", "alerts", "usage"] as const;
export type DashboardPart = (typeof DASHBOARD_PARTS)[number];
export const DASHBOARD_PART_LABEL: Record<DashboardPart, string> = {
  stats: "Totals at the top",
  clients: "Clients overview",
  alerts: "Recent alerts",
  usage: "Plan usage",
};

/** Search text: trimmed, one space between words, at most 80 characters. Null when too short. */
export function cleanSearchText(text: string | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return t.length >= 2 ? t : null;
}
