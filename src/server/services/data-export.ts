import "server-only";
import { Readable } from "node:stream";
import type { Prisma } from "@prisma/client";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db, rawDb } from "@/server/db/client";
import { enqueueExport } from "@/server/jobs/enqueue";
import { logger } from "@/server/logger";
import { getStorage } from "@/server/providers/storage";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";

export const EXPORT_DAYS = 7;
const PAGE = 1000;

function requireOwner(ctx: TenantContext): void {
  if (!can(ctx.role, "agency.manage")) throw new ForbiddenError();
}

export function exportKey(agencyId: string, exportId: string): string {
  return `exports/${agencyId}/${exportId}.zip`;
}

/** The newest exports first. Only owners may see them. */
export async function listExports(ctx: TenantContext) {
  requireOwner(ctx);
  return db.dataExport.findMany({
    where: { agencyId: ctx.agencyId },
    select: { id: true, status: true, bytes: true, error: true, createdAt: true, expiresAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 5,
  });
}

/** Starts an export. One at a time: a second request while one is waiting is refused. */
export async function requestExport(
  ctx: TenantContext,
  options: { now?: Date; enqueue?: typeof enqueueExport } = {},
) {
  requireOwner(ctx);
  const now = options.now ?? new Date();
  const running = await db.dataExport.findFirst({
    where: {
      agencyId: ctx.agencyId,
      status: "QUEUED",
      createdAt: { gt: new Date(now.getTime() - 3_600_000) },
    },
    select: { id: true },
  });
  if (running)
    throw new ConflictError("An export is already being prepared. Please wait for it to finish.");
  const row = await db.dataExport.create({
    data: {
      agencyId: ctx.agencyId,
      requestedById: ctx.userId,
      expiresAt: new Date(now.getTime() + EXPORT_DAYS * 86_400_000),
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "agency.export_requested",
    targetType: "DataExport",
    targetId: row.id,
  });
  await (options.enqueue ?? enqueueExport)({ exportId: row.id, agencyId: ctx.agencyId });
  return row;
}

/** The zip, for the owner of this agency. Expired or unfinished exports are "not found". */
export async function readExport(ctx: TenantContext, exportId: string, now = new Date()) {
  requireOwner(ctx);
  const row = await db.dataExport.findFirst({
    where: { id: exportId, agencyId: ctx.agencyId, status: "READY", expiresAt: { gt: now } },
    select: { storageKey: true, createdAt: true },
  });
  if (!row?.storageKey) throw new NotFoundError("Export not found.");
  const file = await getStorage().get(row.storageKey);
  if (!file) throw new NotFoundError("Export not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "agency.export_downloaded",
    targetType: "DataExport",
    targetId: exportId,
  });
  return { bytes: file.bytes, createdAt: row.createdAt };
}

type Row = { id: string };
type Finder<T extends Row> = (args: {
  take: number;
  skip?: number;
  cursor?: { id: string };
}) => Promise<T[]>;

/** Reads a table in pages with an id cursor, so memory stays small however big the table is. */
async function* allRows<T extends Row>(find: Finder<T>): AsyncGenerator<T> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await find({ take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    for (const row of rows) yield row;
    if (rows.length < PAGE) return;
    cursor = rows[rows.length - 1]!.id;
  }
}

const line = (row: unknown) =>
  `${JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? Number(v) : v))}\n`;

/**
 * Everything an owner may take with them, one JSON-lines file per table. Secrets are left out:
 * no password hashes, session or share tokens, two-step secrets, invitation tokens or provider ids.
 */
export function exportFiles(
  agencyId: string,
): { name: string; model: string; rows: AsyncGenerator<unknown> }[] {
  const where = { agencyId };
  const order = { orderBy: { id: "asc" as const } };
  const one = async function* (value: Promise<unknown>) {
    const found = await value;
    if (found) yield found;
  };
  return [
    {
      name: "agency.jsonl",
      model: "Agency",
      rows: one(
        rawDb.agency.findUnique({
          where: { id: agencyId },
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            status: true,
            createdAt: true,
            alertDropPositions: true,
            alertDropWithin: true,
            alertTopPosition: true,
            alertOnCriticalAudit: true,
            dailyDigest: true,
          },
        }),
      ) as never,
    },
    {
      name: "team.jsonl",
      model: "AgencyMember",
      rows: allRows((a) =>
        rawDb.agencyMember.findMany({
          where,
          select: {
            id: true,
            role: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
          },
          ...order,
          ...a,
        }),
      ),
    },
    {
      name: "clients.jsonl",
      model: "Client",
      rows: allRows((a) => rawDb.client.findMany({ where, ...order, ...a })),
    },
    {
      name: "client-users.jsonl",
      model: "ClientUser",
      rows: allRows((a) =>
        rawDb.clientUser.findMany({
          where,
          select: {
            id: true,
            clientId: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
          },
          ...order,
          ...a,
        }),
      ),
    },
    {
      name: "projects.jsonl",
      model: "Project",
      rows: allRows((a) => rawDb.project.findMany({ where, ...order, ...a })),
    },
    {
      name: "keywords.jsonl",
      model: "Keyword",
      rows: allRows((a) => rawDb.keyword.findMany({ where, ...order, ...a })),
    },
    {
      name: "rank-checks.jsonl",
      model: "RankCheck",
      rows: allRows((a) => rawDb.rankCheck.findMany({ where, ...order, ...a })),
    },
    {
      name: "audits.jsonl",
      model: "Audit",
      rows: allRows((a) =>
        rawDb.audit.findMany({
          where,
          select: {
            id: true,
            projectId: true,
            status: true,
            healthScore: true,
            pagesCrawled: true,
            counts: true,
            startedAt: true,
            finishedAt: true,
            createdAt: true,
          },
          ...order,
          ...a,
        }),
      ),
    },
    {
      name: "audit-pages.jsonl",
      model: "AuditPage",
      rows: allRows((a) => rawDb.auditPage.findMany({ where, ...order, ...a })),
    },
    {
      name: "audit-issues.jsonl",
      model: "AuditIssue",
      rows: allRows((a) => rawDb.auditIssue.findMany({ where, ...order, ...a })),
    },
    {
      name: "keyword-lists.jsonl",
      model: "KeywordList",
      rows: allRows((a) => rawDb.keywordList.findMany({ where, ...order, ...a })),
    },
    {
      name: "keyword-list-items.jsonl",
      model: "KeywordListItem",
      rows: allRows((a) => rawDb.keywordListItem.findMany({ where, ...order, ...a })),
    },
    {
      name: "alerts.jsonl",
      model: "Alert",
      rows: allRows((a) => rawDb.alert.findMany({ where, ...order, ...a })),
    },
    {
      name: "reports.jsonl",
      model: "Report",
      rows: allRows((a) =>
        rawDb.report.findMany({
          where,
          select: {
            id: true,
            projectId: true,
            title: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            sections: true,
            notes: true,
            data: true,
            generatedAt: true,
            createdAt: true,
          },
          ...order,
          ...a,
        }),
      ),
    },
    {
      name: "report-schedules.jsonl",
      model: "ReportSchedule",
      rows: allRows((a) => rawDb.reportSchedule.findMany({ where, ...order, ...a })),
    },
    {
      name: "branding.jsonl",
      model: "Branding",
      rows: allRows((a) =>
        rawDb.branding.findMany({
          where,
          select: {
            id: true,
            displayName: true,
            primaryColor: true,
            accentColor: true,
            supportEmail: true,
            website: true,
            customDomain: true,
            createdAt: true,
          },
          ...order,
          ...a,
        }),
      ),
    },
    {
      name: "invoices.jsonl",
      model: "Invoice",
      rows: allRows((a) => rawDb.invoice.findMany({ where, ...order, ...a })),
    },
    {
      name: "usage.jsonl",
      model: "UsageRecord",
      rows: allRows((a) => rawDb.usageRecord.findMany({ where, ...order, ...a })),
    },
    {
      name: "backlinks.jsonl",
      model: "Backlink",
      rows: allRows((a) => rawDb.backlink.findMany({ where, ...order, ...a })),
    },
    {
      name: "backlink-snapshots.jsonl",
      model: "BacklinkSnapshot",
      rows: allRows((a) => rawDb.backlinkSnapshot.findMany({ where, ...order, ...a })),
    },
    {
      name: "competitors.jsonl",
      model: "Competitor",
      rows: allRows((a) => rawDb.competitor.findMany({ where, ...order, ...a })),
    },
    {
      name: "competitor-keywords.jsonl",
      model: "CompetitorKeyword",
      rows: allRows((a) => rawDb.competitorKeyword.findMany({ where, ...order, ...a })),
    },
    {
      name: "ai-prompts.jsonl",
      model: "AiPrompt",
      rows: allRows((a) => rawDb.aiPrompt.findMany({ where, ...order, ...a })),
    },
    {
      name: "ai-settings.jsonl",
      model: "AiSetting",
      rows: allRows((a) => rawDb.aiSetting.findMany({ where, ...order, ...a })),
    },
    {
      name: "ai-visibility-checks.jsonl",
      model: "AiVisibilityCheck",
      rows: allRows((a) => rawDb.aiVisibilityCheck.findMany({ where, ...order, ...a })),
    },
    {
      name: "local-businesses.jsonl",
      model: "LocalBusiness",
      rows: allRows((a) => rawDb.localBusiness.findMany({ where, ...order, ...a })),
    },
    {
      name: "review-snapshots.jsonl",
      model: "ReviewSnapshot",
      rows: allRows((a) => rawDb.reviewSnapshot.findMany({ where, ...order, ...a })),
    },
    {
      name: "reviews.jsonl",
      model: "Review",
      rows: allRows((a) => rawDb.review.findMany({ where, ...order, ...a })),
    },
    {
      // The tokens are left out: they are secrets and useless outside this platform.
      name: "google-connections.jsonl",
      model: "GoogleConnection",
      rows: allRows((a) =>
        rawDb.googleConnection.findMany({
          where,
          select: {
            id: true,
            projectId: true,
            accountEmail: true,
            gscSite: true,
            ga4PropertyId: true,
            ga4PropertyName: true,
            status: true,
            lastSyncedOn: true,
            createdAt: true,
          },
          ...order,
          ...a,
        }),
      ),
    },
    {
      name: "search-console-days.jsonl",
      model: "SearchConsoleDay",
      rows: allRows((a) => rawDb.searchConsoleDay.findMany({ where, ...order, ...a })),
    },
    {
      name: "ga4-days.jsonl",
      model: "Ga4Day",
      rows: allRows((a) => rawDb.ga4Day.findMany({ where, ...order, ...a })),
    },
    {
      // The public id is left out: it is a secret that opens the visitor's result.
      name: "leads.jsonl",
      model: "Lead",
      rows: allRows((a) =>
        rawDb.lead.findMany({
          where,
          select: {
            id: true,
            domain: true,
            email: true,
            status: true,
            healthScore: true,
            pagesCrawled: true,
            issues: true,
            createdAt: true,
            finishedAt: true,
          },
          ...order,
          ...a,
        }),
      ),
    },
    {
      name: "tasks.jsonl",
      model: "Task",
      rows: allRows((a) => rawDb.task.findMany({ where, ...order, ...a })),
    },
    {
      name: "task-comments.jsonl",
      model: "TaskComment",
      rows: allRows((a) => rawDb.taskComment.findMany({ where, ...order, ...a })),
    },
    {
      name: "milestones.jsonl",
      model: "Milestone",
      rows: allRows((a) => rawDb.milestone.findMany({ where, ...order, ...a })),
    },
    {
      name: "task-templates.jsonl",
      model: "TaskTemplate",
      rows: allRows((a) => rawDb.taskTemplate.findMany({ where, ...order, ...a })),
    },
    {
      name: "report-comments.jsonl",
      model: "ReportComment",
      rows: allRows((a) => rawDb.reportComment.findMany({ where, ...order, ...a })),
    },
    {
      name: "report-templates.jsonl",
      model: "ReportTemplate",
      rows: allRows((a) => rawDb.reportTemplate.findMany({ where, ...order, ...a })),
    },
    {
      name: "annotations.jsonl",
      model: "Annotation",
      rows: allRows((a) => rawDb.annotation.findMany({ where, ...order, ...a })),
    },
    {
      name: "goals.jsonl",
      model: "Goal",
      rows: allRows((a) => rawDb.goal.findMany({ where, ...order, ...a })),
    },
    {
      name: "goal-points.jsonl",
      model: "GoalPoint",
      rows: allRows((a) => rawDb.goalPoint.findMany({ where, ...order, ...a })),
    },
    {
      name: "search-breakdowns.jsonl",
      model: "SearchBreakdown",
      rows: allRows((a) => rawDb.searchBreakdown.findMany({ where, ...order, ...a })),
    },
    {
      name: "analytics-pages.jsonl",
      model: "Ga4Page",
      rows: allRows((a) => rawDb.ga4Page.findMany({ where, ...order, ...a })),
    },
    {
      name: "ai-market.jsonl",
      model: "AiMarketSnapshot",
      rows: allRows((a) => rawDb.aiMarketSnapshot.findMany({ where, ...order, ...a })),
    },
    {
      name: "activity-log.jsonl",
      model: "ActivityLog",
      rows: allRows((a) => rawDb.activityLog.findMany({ where, ...order, ...a })),
    },
  ];
}

/**
 * Tenant tables that are not in the export, and why. A test checks that every tenant table is
 * either exported or listed here, so a new table cannot be forgotten.
 */
export const EXPORT_EXCLUDED: Record<string, string> = {
  Invitation: "holds secret invitation tokens",
  Subscription: "billing state of the platform, see the invoices file",
  PendingProviderTask: "internal queue of data supplier tasks",
  BillingEvent: "internal payment provider events",
  CheckoutSession: "internal payment provider sessions",
  Impersonation: "internal support sessions (the activity log has the record)",
  UsageBonus: "internal credits given by support",
  DataExport: "the exports themselves",
};

const README = `This is a copy of your agency's data.

Each .jsonl file has one record per line (JSON). Open them with any text editor,
or load them into a spreadsheet or database tool.

Not included for safety: passwords, sign-in sessions, secret links and tokens,
and anything that belongs to the companies that supply our data.
`;

/**
 * Builds the zip for an export and saves it. Runs in the worker. A repeat of the same job
 * (retry) starts over and replaces the file.
 */
export async function buildAgencyExport(
  agencyId: string,
  exportId: string,
  options: { finalAttempt?: boolean } = {},
): Promise<{ status: "READY" | "FAILED" | "SKIPPED"; bytes?: number }> {
  const row = await rawDb.dataExport.findFirst({
    where: { id: exportId, agencyId },
    select: { id: true },
  });
  if (!row) return { status: "SKIPPED" };
  try {
    // archiver is an ES module package; the worker is CommonJS, so it is loaded with import().
    const { ZipArchive } = await import("archiver");
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
    });
    archive.append(README, { name: "README.txt" });
    for (const file of exportFiles(agencyId)) {
      archive.append(
        Readable.from(
          (async function* () {
            for await (const item of file.rows) yield line(item);
          })(),
        ),
        { name: file.name },
      );
    }
    await archive.finalize();
    await finished;
    const bytes = Buffer.concat(chunks);
    const key = exportKey(agencyId, exportId);
    await getStorage().put(key, bytes, "application/zip");
    await rawDb.dataExport.update({
      where: { id: exportId },
      data: {
        status: "READY",
        storageKey: key,
        bytes: bytes.length,
        readyAt: new Date(),
        error: null,
      },
    });
    return { status: "READY", bytes: bytes.length };
  } catch (error) {
    logger.error({ err: error, exportId }, "agency export failed");
    if (!options.finalAttempt) throw error;
    await rawDb.dataExport.update({
      where: { id: exportId },
      data: { status: "FAILED", error: "The export could not be built. Please try again." },
    });
    return { status: "FAILED" };
  }
}

/** Deletes exports past their date, with their files. Part of the daily clean-up. */
export async function purgeExpiredExports(now = new Date()): Promise<number> {
  const old = await rawDb.dataExport.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, storageKey: true },
    take: 500,
  });
  for (const item of old) {
    if (item.storageKey) await getStorage().delete(item.storageKey);
  }
  if (old.length === 0) return 0;
  const result = await rawDb.dataExport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return result.count;
}

export type { Prisma };
