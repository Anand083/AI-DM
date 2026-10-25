import "server-only";
import type { Prisma } from "@prisma/client";
import { BUCKETS, averagePosition, distribution } from "@/lib/rank-math";
import type { ReportModel } from "@/lib/report-model";
import { issueInfo } from "@/server/audit/issue-catalog";
import { can } from "@/server/auth/permissions";
import type { PortalContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { getStorage } from "@/server/providers/storage";
import { ForbiddenError, NotFoundError } from "./errors";
import { paging, type Page } from "./paging";

/**
 * Read-only data for client users. Every query is limited to the agency AND to the clients
 * this person was invited to, so another client's project or report is simply "not found".
 */
function projectWhere(ctx: PortalContext, id?: string): Prisma.ProjectWhereInput {
  return {
    ...(id ? { id } : {}),
    agencyId: ctx.agencyId,
    clientId: { in: ctx.clientIds },
    deletedAt: null,
    client: { deletedAt: null, status: "ACTIVE" },
  };
}

function requireView(ctx: PortalContext): void {
  if (!can(ctx.role, "data.view")) throw new ForbiddenError();
}

export type PortalProject = {
  id: string;
  name: string;
  domain: string;
  clientName: string;
  keywords: number;
  checked: number;
  averagePosition: number | null;
  top10: number;
  auditScore: number | null;
};

async function summarize(
  ctx: PortalContext,
  project: { id: string; name: string; domain: string; client: { name: string } },
): Promise<PortalProject> {
  const [keywords, audit] = await Promise.all([
    db.keyword.findMany({
      where: { agencyId: ctx.agencyId, projectId: project.id },
      select: { currentPosition: true, lastCheckedOn: true },
      take: 5000,
    }),
    db.audit.findFirst({
      where: { agencyId: ctx.agencyId, projectId: project.id, status: "COMPLETED" },
      select: { healthScore: true },
      orderBy: { finishedAt: "desc" },
    }),
  ]);
  const checked = keywords.filter((k) => k.lastCheckedOn !== null);
  const positions = checked.map((k) => k.currentPosition);
  return {
    id: project.id,
    name: project.name,
    domain: project.domain,
    clientName: project.client.name,
    keywords: keywords.length,
    checked: checked.length,
    averagePosition: averagePosition(positions),
    top10: positions.filter((p) => p !== null && p <= 10).length,
    auditScore: audit?.healthScore ?? null,
  };
}

export async function listPortalProjects(ctx: PortalContext, p: Page = {}) {
  requireView(ctx);
  const { take, skip } = paging(p);
  const where = projectWhere(ctx);
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      select: { id: true, name: true, domain: true, client: { select: { name: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.project.count({ where }),
  ]);
  return {
    items: await Promise.all(rows.map((r) => summarize(ctx, r))),
    total,
    page: Math.floor(skip / take) + 1,
    pageSize: take,
  };
}

export async function getPortalProject(ctx: PortalContext, projectId: string) {
  requireView(ctx);
  const project = await db.project.findFirst({
    where: projectWhere(ctx, projectId),
    select: { id: true, name: true, domain: true, client: { select: { name: true } } },
  });
  if (!project) throw new NotFoundError("Project not found.");
  const summary = await summarize(ctx, project);
  const positions = (
    await db.keyword.findMany({
      where: { agencyId: ctx.agencyId, projectId, lastCheckedOn: { not: null } },
      select: { currentPosition: true },
      take: 5000,
    })
  ).map((k) => k.currentPosition);
  const counts = distribution(positions);
  return {
    ...summary,
    distribution: BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts[b.key] })),
  };
}

export async function listPortalKeywords(ctx: PortalContext, projectId: string, p: Page = {}) {
  await getPortalProject(ctx, projectId);
  const { take, skip } = paging(p);
  const where = { agencyId: ctx.agencyId, projectId };
  const [items, total] = await Promise.all([
    db.keyword.findMany({
      where,
      select: {
        id: true,
        phrase: true,
        lastCheckedOn: true,
        currentPosition: true,
        currentUrl: true,
        bestPosition: true,
        changeWeek: true,
        changeMonth: true,
      },
      orderBy: [{ currentPosition: { sort: "asc", nulls: "last" } }, { phrase: "asc" }],
      take,
      skip,
    }),
    db.keyword.count({ where }),
  ]);
  return { items, total, page: Math.floor(skip / take) + 1, pageSize: take };
}

/** The latest finished audit: score, counts and the biggest issues in plain English. */
export async function getPortalAudit(ctx: PortalContext, projectId: string) {
  await getPortalProject(ctx, projectId);
  const audit = await db.audit.findFirst({
    where: { agencyId: ctx.agencyId, projectId, status: "COMPLETED" },
    select: { id: true, healthScore: true, pagesCrawled: true, counts: true, finishedAt: true },
    orderBy: { finishedAt: "desc" },
  });
  if (!audit || audit.healthScore === null) return null;
  const counts = (audit.counts ?? {}) as { critical?: number; warning?: number; notice?: number };
  const groups = await db.auditIssue.groupBy({
    by: ["code"],
    where: { agencyId: ctx.agencyId, auditId: audit.id },
    _count: { _all: true },
    orderBy: { code: "asc" },
    take: 200,
  });
  const order = { CRITICAL: 0, WARNING: 1, NOTICE: 2 } as const;
  const issues = groups
    .map((g) => ({ ...issueInfo(g.code), pages: g._count._all }))
    .sort((a, b) => order[a.severity] - order[b.severity] || b.pages - a.pages)
    .slice(0, 5)
    .map((i) => ({
      code: i.code,
      title: i.title,
      severity: i.severity,
      pages: i.pages,
      fix: i.fix,
    }));
  return {
    healthScore: audit.healthScore,
    pagesCrawled: audit.pagesCrawled,
    finishedAt: audit.finishedAt,
    counts: {
      critical: counts.critical ?? 0,
      warning: counts.warning ?? 0,
      notice: counts.notice ?? 0,
    },
    issues,
  };
}

const reportListSelect = {
  id: true,
  title: true,
  periodStart: true,
  periodEnd: true,
  generatedAt: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.ReportSelect;

function reportWhere(
  ctx: PortalContext,
  extra: Prisma.ReportWhereInput = {},
): Prisma.ReportWhereInput {
  return {
    agencyId: ctx.agencyId,
    status: "READY",
    project: projectWhere(ctx),
    ...extra,
  };
}

export async function listPortalReports(ctx: PortalContext, p: Page & { projectId?: string } = {}) {
  if (!can(ctx.role, "reports.download")) throw new ForbiddenError();
  const { take, skip } = paging(p);
  const where = reportWhere(ctx, p.projectId ? { projectId: p.projectId } : {});
  const [items, total] = await Promise.all([
    db.report.findMany({
      where,
      select: reportListSelect,
      orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
      take,
      skip,
    }),
    db.report.count({ where }),
  ]);
  return { items, total, page: Math.floor(skip / take) + 1, pageSize: take };
}

export async function getPortalReport(ctx: PortalContext, reportId: string) {
  if (!can(ctx.role, "reports.download")) throw new ForbiddenError();
  const report = await db.report.findFirst({
    where: reportWhere(ctx, { id: reportId }),
    select: { ...reportListSelect, data: true },
  });
  if (!report?.data) throw new NotFoundError("Report not found.");
  return { ...report, model: report.data as unknown as ReportModel };
}

export async function readPortalReportPdf(ctx: PortalContext, reportId: string) {
  if (!can(ctx.role, "reports.download")) throw new ForbiddenError();
  const report = await db.report.findFirst({
    where: reportWhere(ctx, { id: reportId }),
    select: { pdfKey: true, title: true, periodEnd: true },
  });
  if (!report?.pdfKey) return null;
  const file = await getStorage().get(report.pdfKey);
  return file
    ? {
        bytes: file.bytes,
        title: report.title,
        periodEnd: report.periodEnd.toISOString().slice(0, 10),
      }
    : null;
}
