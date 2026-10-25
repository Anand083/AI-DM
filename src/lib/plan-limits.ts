/** Plan limits stored in `Plan.limits` (plan section 9.6). -1 means unlimited. */
export type PlanLimits = {
  maxClients: number;
  maxProjects: number;
  maxKeywords: number;
  maxTeamMembers: number;
  maxClientUsers: number;
  auditPagesPerMonth: number;
  keywordResearchPerMonth: number;
  liveChecksPerMonth: number;
  aiChecksPerMonth: number;
  backlinkQueriesPerMonth: number;
  leadAuditsPerMonth: number;
  reportSchedules: number;
  customDomain: boolean;
  whiteLabel: boolean;
};

export const UNLIMITED = -1;

/** The plan limits an add-on can raise: every number in `PlanLimits`. */
export const ADDON_KEYS = [
  "maxClients",
  "maxProjects",
  "maxKeywords",
  "maxTeamMembers",
  "maxClientUsers",
  "reportSchedules",
  "auditPagesPerMonth",
  "keywordResearchPerMonth",
  "liveChecksPerMonth",
  "aiChecksPerMonth",
  "backlinkQueriesPerMonth",
  "leadAuditsPerMonth",
] as const satisfies readonly (keyof PlanLimits)[];
export type AddOnKey = (typeof ADDON_KEYS)[number];

export const isAddOnKey = (v: string): v is AddOnKey =>
  (ADDON_KEYS as readonly string[]).includes(v);

export const ADDON_LABEL: Record<AddOnKey, string> = {
  maxClients: "Clients",
  maxProjects: "Projects",
  maxKeywords: "Keywords",
  maxTeamMembers: "Team members",
  maxClientUsers: "Client logins",
  reportSchedules: "Report schedules",
  auditPagesPerMonth: "Audit pages a month",
  keywordResearchPerMonth: "Keyword searches a month",
  liveChecksPerMonth: "Live checks a month",
  aiChecksPerMonth: "AI checks a month",
  backlinkQueriesPerMonth: "Backlink lookups a month",
  leadAuditsPerMonth: "Lead audits a month",
};

/** Adds granted room to the plan. Unlimited limits stay unlimited. */
export function applyAddOns(
  limits: PlanLimits,
  addOns: readonly { limitKey: string; amount: number }[],
): PlanLimits {
  const next = { ...limits };
  for (const a of addOns) {
    if (!isAddOnKey(a.limitKey) || next[a.limitKey] === UNLIMITED) continue;
    next[a.limitKey] += a.amount;
  }
  return next;
}

export type CountLimitKey =
  | "maxClients"
  | "maxProjects"
  | "maxKeywords"
  | "maxTeamMembers"
  | "maxClientUsers"
  | "reportSchedules";

/** True when adding `adding` more to `current` would go over `limit`. */
export function wouldExceed(limit: number, current: number, adding = 1): boolean {
  return limit !== UNLIMITED && current + adding > limit;
}

/** The monthly plan limit that applies to each usage metric. Metrics not listed have no plan limit. */
export type MonthlyLimitKey =
  | "auditPagesPerMonth"
  | "keywordResearchPerMonth"
  | "liveChecksPerMonth"
  | "aiChecksPerMonth"
  | "backlinkQueriesPerMonth"
  | "leadAuditsPerMonth";

export const METRIC_LIMIT_KEY = {
  AUDIT_PAGE: "auditPagesPerMonth",
  KEYWORD_RESEARCH: "keywordResearchPerMonth",
  LIVE_CHECK: "liveChecksPerMonth",
  AI_CHECK: "aiChecksPerMonth",
  BACKLINK_QUERY: "backlinkQueriesPerMonth",
  LEAD_AUDIT: "leadAuditsPerMonth",
} as const satisfies Record<string, MonthlyLimitKey>;

export type LimitedMetric = keyof typeof METRIC_LIMIT_KEY;

/** Plain-English names for the usage page and error messages. */
export const METRIC_LABEL: Record<LimitedMetric, { plural: string; verb: string }> = {
  AUDIT_PAGE: { plural: "audit pages", verb: "crawled" },
  KEYWORD_RESEARCH: { plural: "keyword research searches", verb: "used" },
  LIVE_CHECK: { plural: "live rank checks", verb: "used" },
  AI_CHECK: { plural: "AI visibility checks", verb: "used" },
  BACKLINK_QUERY: { plural: "backlink lookups", verb: "used" },
  LEAD_AUDIT: { plural: "lead audits", verb: "used" },
};

export function isLimitedMetric(metric: string): metric is LimitedMetric {
  return metric in METRIC_LIMIT_KEY;
}
