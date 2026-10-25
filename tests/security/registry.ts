/**
 * The list of every entry point that receives input from the outside, and how each one protects
 * itself. `registry.test.ts` reads the source files and checks that:
 *  - every route handler and every "use server" file is listed here (so a new one cannot be added
 *    without someone deciding how it is protected), and
 *  - the file really contains the guard it claims to use.
 *
 * Keys are paths from the project root.
 */

export type RouteGuard =
  | "tenant" // a signed-in member of the agency in the URL (loadTenantContext)
  | "portal" // a signed-in client user of the agency in the URL (loadPortalContext)
  | "share-token" // the secret token in the URL (getSharedReport), rate limited
  | "provider-secret" // a shared secret in the request (provider callbacks)
  | "billing-signature" // a signed webhook body
  | "feature-flag" // returns 404 unless the feature flag is on
  | "dev-only" // returns 404 in production
  | "public-agency-brand" // public information about an agency (logo), rate limited
  | "public-lead-token" // the long random id of a widget lead; returns the result only, rate limited
  | "public-static" // the same text for everyone, no data
  | "api-key" // a key for the public API; the key decides the agency and its permission
  | "auth-library" // handled by Better Auth
  | "health"; // no data

export const ROUTES: Record<string, RouteGuard> = {
  "src/app/api/auth/[...all]/route.ts": "auth-library",
  "src/app/api/dev/billing/advance/route.ts": "dev-only",
  "src/app/widget/embed.js/route.ts": "public-static",
  "src/app/api/google/callback/route.ts": "tenant",
  "src/app/api/google/start/route.ts": "tenant",
  "src/app/api/health/route.ts": "health",
  "src/app/api/v1/alerts/route.ts": "api-key",
  "src/app/api/v1/clients/route.ts": "api-key",
  "src/app/api/v1/projects/route.ts": "api-key",
  "src/app/api/v1/projects/[projectId]/rankings/route.ts": "api-key",
  "src/app/api/widget/lead/[publicId]/route.ts": "public-lead-token",
  "src/app/api/internal/domain-allowed/route.ts": "feature-flag",
  "src/app/api/internal/domain-resolve/route.ts": "feature-flag",
  "src/app/api/providers/dataforseo/pingback/route.ts": "provider-secret",
  "src/app/api/providers/dataforseo/postback/route.ts": "provider-secret",
  "src/app/api/webhooks/billing/route.ts": "billing-signature",
  "src/app/app/[agencySlug]/branding/logo/route.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/rankings/export/route.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/backlinks/export/route.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/content/export/route.ts": "tenant",
  "src/app/app/[agencySlug]/performance/export/route.ts": "tenant",
  "src/app/app/[agencySlug]/reports/[reportId]/pdf/route.ts": "tenant",
  "src/app/app/[agencySlug]/research/export/route.ts": "tenant",
  "src/app/app/[agencySlug]/research/lists/[listId]/export/route.ts": "tenant",
  "src/app/app/[agencySlug]/settings/export/[exportId]/route.ts": "tenant",
  "src/app/portal/[agencySlug]/(portal)/reports/[reportId]/pdf/route.ts": "portal",
  "src/app/portal/[agencySlug]/logo/route.ts": "public-agency-brand",
  "src/app/r/[token]/logo/route.ts": "share-token",
  "src/app/r/[token]/pdf/route.ts": "share-token",
};

/** A string that must appear in a route file for each kind of guard. */
export const ROUTE_GUARD_MARKERS: Record<RouteGuard, string[]> = {
  tenant: ["loadTenantContext("],
  portal: ["loadPortalContext("],
  "share-token": ["getSharedReport(", "limitRequest("],
  "provider-secret": ["handlePingback", "handlePostback"], // either; the shared handler checks the secret
  "billing-signature": ["handleBillingWebhook(", "limitRequest("],
  "feature-flag": ["CUSTOM_DOMAINS_ENABLED"],
  "dev-only": ["devBillingAllowed("],
  "public-agency-brand": ["loadPortalBrand(", "limitRequest("],
  "public-lead-token": ["getLeadStatus(", "limitRequest("],
  "public-static": ["export async function GET"],
  "api-key": ["withApiKey("],
  "auth-library": ["toNextJsHandler("],
  health: ["export async function GET"],
};

export type ActionGuard =
  | "tenant" // every exported action goes through withTenantAction
  | "admin" // every exported action goes through withAdminAction (or requireSuperAdmin)
  | "own-account" // acts only on the signed-in person's own records
  | "portal" // every exported action goes through withPortalAction (a client user of the agency)
  | "token" // proof is a secret token that was sent to the person
  | "public-limited"; // no sign-in on purpose; limited by IP address and validated

export const ACTION_FILES: Record<string, ActionGuard> = {
  "src/app/account-actions.ts": "own-account",
  "src/app/admin-actions.ts": "admin",
  "src/app/app/[agencySlug]/alerts/actions.ts": "tenant",
  "src/app/app/[agencySlug]/billing/actions.ts": "tenant",
  "src/app/app/[agencySlug]/branding/actions.ts": "tenant",
  "src/app/app/[agencySlug]/branding/domain-actions.ts": "tenant",
  "src/app/app/[agencySlug]/clients/actions.ts": "tenant",
  "src/app/app/[agencySlug]/clients/client-user-actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/audit/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/backlinks/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/competitors/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/ai-visibility/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/reviews/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/analytics/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/milestones/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/goals/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/assistant/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/content/actions.ts": "tenant",
  "src/app/app/[agencySlug]/profitability/actions.ts": "tenant",
  "src/app/app/[agencySlug]/integrations/actions.ts": "tenant",
  "src/app/app/[agencySlug]/views/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/locations/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/keyword-insights/actions.ts": "tenant",
  "src/app/app/[agencySlug]/leads/actions.ts": "tenant",
  "src/app/app/[agencySlug]/tasks/actions.ts": "tenant",
  "src/app/app/[agencySlug]/projects/[projectId]/rankings/actions.ts": "tenant",
  "src/app/app/[agencySlug]/reports/actions.ts": "tenant",
  "src/app/app/[agencySlug]/reports/schedules/actions.ts": "tenant",
  "src/app/app/[agencySlug]/research/actions.ts": "tenant",
  "src/app/app/[agencySlug]/settings/actions.ts": "tenant",
  "src/app/app/[agencySlug]/team/actions.ts": "tenant",
  "src/app/app/onboarding/actions.ts": "own-account",
  "src/app/(marketing)/contact/actions.ts": "public-limited",
  "src/app/widget/[agencySlug]/actions.ts": "public-limited",
  "src/app/invite-actions.ts": "token",
  "src/app/portal-actions.ts": "token",
  "src/app/portal/[agencySlug]/(portal)/tasks/actions.ts": "portal",
};

/** Which wrapper or check each kind of action file must use. */
export const ACTION_GUARD_MARKERS: Record<ActionGuard, string[]> = {
  tenant: ["withTenantAction("],
  portal: ["withPortalAction("],
  admin: ["withAdminAction(", "requireSuperAdmin("],
  "own-account": ["getRealSessionUser(", "getSessionUser(", "requireUser("],
  token: ["getSessionUser(", "acceptInvitation(", "createClientAccount("],
  "public-limited": ["allow("],
};

/**
 * Pages that need their own check. Layouts alone are not enough, so each page under these
 * folders must call the guard itself.
 */
export const PAGE_FOLDERS: { folder: string; marker: string; except?: string[] }[] = [
  { folder: "src/app/app/[agencySlug]", marker: "getPageContext(" },
  { folder: "src/app/admin", marker: "requireSuperAdmin(" },
  { folder: "src/app/portal/[agencySlug]/(portal)", marker: "getPortalPageContext(" },
];
