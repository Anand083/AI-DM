/**
 * Tenant guard (plan section 7.1).
 *
 * Every query on a tenant-owned model must say which agency it is for.
 * In development and test the guard throws when `agencyId` is missing.
 * In production it does nothing, so a bug here can never take the site down;
 * the tests are what keep us safe.
 */

/** Models that have a required `agencyId`. */
export const TENANT_MODELS = new Set([
  "AgencyMember",
  "Invitation",
  "Client",
  "ClientUser",
  "Project",
  "Subscription",
  "ActivityLog",
  "UsageRecord",
  "PendingProviderTask",
  "Keyword",
  "RankCheck",
  "Audit",
  "AuditPage",
  "AuditIssue",
  "KeywordList",
  "KeywordListItem",
  "Alert",
  "Branding",
  "Report",
  "ReportSchedule",
  "BillingEvent",
  "Invoice",
  "CheckoutSession",
  "Impersonation",
  "UsageBonus",
  "DataExport",
  "Backlink",
  "BacklinkSnapshot",
  "Competitor",
  "CompetitorKeyword",
  "AiPrompt",
  "AiSetting",
  "AiVisibilityCheck",
  "LocalBusiness",
  "ReviewSnapshot",
  "Review",
  "GoogleConnection",
  "SearchConsoleDay",
  "Ga4Day",
  "Lead",
  "Task",
  "TaskComment",
  "Milestone",
  "TaskTemplate",
  "ReportComment",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

export class TenantGuardError extends Error {
  constructor(model: string, operation: string, detail: string) {
    super(`Tenant guard: ${model}.${operation} ${detail}`);
    this.name = "TenantGuardError";
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when the value is a usable agency id filter (a string, or `{ equals: string }`). */
function hasAgencyValue(v: unknown): boolean {
  if (typeof v === "string") return v.length > 0;
  return isObj(v) && typeof v.equals === "string" && v.equals.length > 0;
}

function whereHasAgency(where: unknown): boolean {
  if (!isObj(where)) return false;
  if (hasAgencyValue(where.agencyId)) return true;
  // Compound unique keys such as { agencyId_userId: { agencyId, userId } }.
  for (const [key, value] of Object.entries(where)) {
    if (key.includes("_") && isObj(value) && hasAgencyValue(value.agencyId)) return true;
  }
  const and = where.AND;
  const parts = Array.isArray(and) ? and : and === undefined ? [] : [and];
  return parts.some(whereHasAgency);
}

function dataHasAgency(data: unknown): boolean {
  if (!isObj(data)) return false;
  if (hasAgencyValue(data.agencyId)) return true;
  // Nested form: { agency: { connect: { id } } }
  const agency = data.agency;
  return isObj(agency) && isObj(agency.connect) && hasAgencyValue(agency.connect.id);
}

/** Throws a TenantGuardError when a query on a tenant model has no agency scope. */
export function assertTenantScoped(model: string, operation: string, args: unknown): void {
  if (!TENANT_MODELS.has(model)) return;
  const a: Obj = isObj(args) ? args : {};

  if (WHERE_OPERATIONS.has(operation) && !whereHasAgency(a.where)) {
    throw new TenantGuardError(model, operation, "needs agencyId in `where`");
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const payload = operation === "upsert" ? a.create : a.data;
    const rows = Array.isArray(payload) ? payload : [payload];
    if (rows.length === 0 || !rows.every(dataHasAgency)) {
      throw new TenantGuardError(model, operation, "needs agencyId in `data`");
    }
  }
}

export function isGuardEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}
