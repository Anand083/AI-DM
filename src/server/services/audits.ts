import "server-only";
import { Prisma } from "@prisma/client";
import {
  compareIssues,
  countBySeverity,
  healthScore,
  type IssueComparison,
} from "@/lib/audit-math";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueAuditRun } from "@/server/jobs/enqueue";
import { ISSUE_CATALOG, issueInfo, severityRank } from "@/server/audit/issue-catalog";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError } from "./errors";
import { paging, type Page } from "./paging";
import { getProject } from "./projects";
import { getAgencyPlan, getUsageByMetric } from "./usage";

/** The most pages one audit may crawl, whatever the plan allows. */
export const MAX_PAGES_PER_AUDIT = 500;

type Agency = { agencyId: string };

/**
 * Starts an audit for a project: checks nothing is running, works out how many pages the plan
 * still allows this month, saves the audit and queues it for the worker.
 * Used by people (with a permission check) and by the monthly scheduler.
 */
export async function createAudit(
  agency: Agency,
  projectId: string,
  requestedById: string | null,
  enqueue: (data: { auditId: string; agencyId: string }) => Promise<void> = enqueueAuditRun,
) {
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      agencyId: agency.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Project not found.");

  const running = await db.audit.findFirst({
    where: { agencyId: agency.agencyId, projectId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (running) throw new ConflictError("An audit is already running for this project.");

  const plan = await getAgencyPlan(agency);
  if (plan.status === "EXPIRED" || plan.status === "CANCELED") {
    throw new LimitExceededError("Your subscription has ended. Choose a plan to continue.");
  }
  const limit = plan.limits.auditPagesPerMonth;
  let maxPages = MAX_PAGES_PER_AUDIT;
  if (limit !== -1) {
    const used = (await getUsageByMetric(agency, plan.period)).AUDIT_PAGE ?? 0;
    const remaining = Math.max(0, limit - used);
    if (remaining === 0) {
      throw new LimitExceededError(
        `You have used all ${limit} audit pages for this month on your ${plan.planName} plan. Upgrade your plan to get more.`,
      );
    }
    maxPages = Math.min(maxPages, remaining);
  }

  const audit = await db.audit.create({
    data: { agencyId: agency.agencyId, projectId, maxPages, requestedById },
    select: { id: true, maxPages: true },
  });
  await logActivity({
    agencyId: agency.agencyId,
    actorUserId: requestedById,
    action: "audit.started",
    targetType: "Audit",
    targetId: audit.id,
    metadata: { projectId, maxPages },
  });
  await enqueue({ auditId: audit.id, agencyId: agency.agencyId });
  return audit;
}

export async function startAudit(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  return createAudit(ctx, projectId, ctx.userId);
}

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

const auditSelect = {
  id: true,
  projectId: true,
  status: true,
  progress: true,
  maxPages: true,
  pagesCrawled: true,
  healthScore: true,
  counts: true,
  startedAt: true,
  finishedAt: true,
  error: true,
  createdAt: true,
} satisfies Prisma.AuditSelect;

export type AuditCounts = {
  critical: number;
  warning: number;
  notice: number;
  byCode: Record<string, number>;
};

export async function listAudits(ctx: TenantContext, projectId: string, p: Page = {}) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { take, skip } = paging({ pageSize: 20, ...p });
  const where = { agencyId: ctx.agencyId, projectId };
  const [rows, total] = await Promise.all([
    db.audit.findMany({ where, select: auditSelect, orderBy: { createdAt: "desc" }, take, skip }),
    db.audit.count({ where }),
  ]);
  return { rows, total };
}

export async function getAudit(ctx: TenantContext, projectId: string, auditId: string) {
  requireView(ctx);
  const audit = await db.audit.findFirst({
    where: { id: auditId, agencyId: ctx.agencyId, projectId },
    select: auditSelect,
  });
  if (!audit) throw new NotFoundError("Audit not found.");
  return { ...audit, counts: audit.counts as AuditCounts | null };
}

/** Progress for the page's polling. */
export async function getAuditProgress(ctx: TenantContext, projectId: string, auditId: string) {
  const audit = await getAudit(ctx, projectId, auditId);
  return { status: audit.status, progress: audit.progress, error: audit.error };
}

export type IssueGroup = {
  code: string;
  title: string;
  why: string;
  fix: string;
  severity: "CRITICAL" | "WARNING" | "NOTICE";
  count: number;
  /** A few of the affected page addresses. */
  sampleUrls: string[];
};

export const SAMPLE_URLS = 10;

/** Issues of an audit grouped by type, worst first, each with a few example pages. */
export async function getIssueGroups(
  ctx: TenantContext,
  projectId: string,
  auditId: string,
): Promise<IssueGroup[]> {
  await getAudit(ctx, projectId, auditId);
  const groups = await db.auditIssue.groupBy({
    by: ["code", "severity"],
    where: { agencyId: ctx.agencyId, auditId },
    _count: { _all: true },
  });
  const withSamples = await Promise.all(
    groups.map(async (g) => {
      const samples = await db.auditIssue.findMany({
        where: { agencyId: ctx.agencyId, auditId, code: g.code },
        select: { url: true },
        orderBy: { url: "asc" },
        take: SAMPLE_URLS,
      });
      const info = issueInfo(g.code);
      return {
        code: g.code,
        title: info.title,
        why: info.why,
        fix: info.fix,
        severity: g.severity,
        count: g._count._all,
        sampleUrls: samples.map((s) => s.url),
      } satisfies IssueGroup;
    }),
  );
  return withSamples.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      b.count - a.count ||
      a.code.localeCompare(b.code),
  );
}

/** Every affected address for one issue type (paged). */
export async function listIssueUrls(
  ctx: TenantContext,
  projectId: string,
  auditId: string,
  code: string,
  p: Page = {},
) {
  await getAudit(ctx, projectId, auditId);
  const { take, skip } = paging({ pageSize: 50, ...p });
  const where = { agencyId: ctx.agencyId, auditId, code };
  const [rows, total] = await Promise.all([
    db.auditIssue.findMany({ where, select: { url: true }, orderBy: { url: "asc" }, take, skip }),
    db.auditIssue.count({ where }),
  ]);
  return {
    urls: rows.map((r) => r.url),
    total,
    info: ISSUE_CATALOG[code as keyof typeof ISSUE_CATALOG] ?? issueInfo(code),
  };
}

export const PAGE_SORTS = ["issues", "slowest", "url"] as const;
export type PageSort = (typeof PAGE_SORTS)[number];

export async function listAuditPages(
  ctx: TenantContext,
  projectId: string,
  auditId: string,
  options: Page & { sort?: PageSort; q?: string } = {},
) {
  await getAudit(ctx, projectId, auditId);
  const { take, skip } = paging({ pageSize: 50, ...options });
  const q = options.q?.trim().slice(0, 200);
  const where: Prisma.AuditPageWhereInput = {
    agencyId: ctx.agencyId,
    auditId,
    ...(q ? { url: { contains: q, mode: "insensitive" } } : {}),
  };
  const orderBy: Prisma.AuditPageOrderByWithRelationInput[] =
    options.sort === "slowest"
      ? [{ loadTimeMs: "desc" }, { url: "asc" }]
      : options.sort === "url"
        ? [{ url: "asc" }]
        : [{ issueCount: "desc" }, { url: "asc" }];
  const [rows, total] = await Promise.all([
    db.auditPage.findMany({
      where,
      select: {
        id: true,
        url: true,
        statusCode: true,
        title: true,
        loadTimeMs: true,
        wordCount: true,
        issueCount: true,
      },
      orderBy,
      take,
      skip,
    }),
    db.auditPage.count({ where }),
  ]);
  return { rows, total };
}

export type AuditComparison = IssueComparison & {
  previousAuditId: string;
  previousDate: Date;
  previousScore: number | null;
};

/** Compares an audit with the one before it (the last completed audit of the same project). */
export async function compareWithPrevious(
  ctx: TenantContext,
  projectId: string,
  auditId: string,
): Promise<AuditComparison | null> {
  const audit = await getAudit(ctx, projectId, auditId);
  if (audit.status !== "COMPLETED") return null;
  const previous = await db.audit.findFirst({
    where: {
      agencyId: ctx.agencyId,
      projectId,
      status: "COMPLETED",
      createdAt: { lt: audit.createdAt },
    },
    select: { id: true, createdAt: true, healthScore: true },
    orderBy: { createdAt: "desc" },
  });
  if (!previous) return null;
  const [before, now] = await Promise.all([
    db.auditIssue.findMany({
      where: { agencyId: ctx.agencyId, auditId: previous.id },
      select: { code: true, url: true },
      take: 20_000,
    }),
    db.auditIssue.findMany({
      where: { agencyId: ctx.agencyId, auditId },
      select: { code: true, url: true },
      take: 20_000,
    }),
  ]);
  return {
    ...compareIssues(before, now),
    previousAuditId: previous.id,
    previousDate: previous.createdAt,
    previousScore: previous.healthScore,
  };
}

/** The newest completed audit of a project, for dashboards. */
export async function getLatestCompletedAudit(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  return db.audit.findFirst({
    where: { agencyId: ctx.agencyId, projectId, status: "COMPLETED" },
    select: { id: true, healthScore: true, finishedAt: true, pagesCrawled: true, counts: true },
    orderBy: { createdAt: "desc" },
  });
}

export { countBySeverity, healthScore };
