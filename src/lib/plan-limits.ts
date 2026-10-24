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

export type CountLimitKey =
  "maxClients" | "maxProjects" | "maxKeywords" | "maxTeamMembers" | "maxClientUsers";

/** True when adding `adding` more to `current` would go over `limit`. */
export function wouldExceed(limit: number, current: number, adding = 1): boolean {
  return limit !== UNLIMITED && current + adding > limit;
}
