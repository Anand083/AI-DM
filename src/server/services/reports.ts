import "server-only";
import type { Prisma } from "@prisma/client";
import { PeriodError, resolvePeriod, type PeriodKind } from "@/lib/report-period";
import type { ReportModel, ReportSectionKey } from "@/lib/report-model";
import { reportSchema, shareSchema } from "@/lib/schemas/report";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueReport } from "@/server/jobs/enqueue";
import { getStorage } from "@/server/providers/storage";
import { generateToken } from "@/server/tokens";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";
import { assertNotReadOnly } from "./usage";
import { parseInput } from "./validation";

type Enqueue = (data: { reportId: string; agencyId: string }) => Promise<void>;

function requireView(ctx: TenantContext): void {
  if (!can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireCreate(ctx: TenantContext): void {
  if (!can(ctx.role, "reports.create")) throw new ForbiddenError();
}

const day = (d: Date) => d.toISOString().slice(0, 10);

const reportSelect = {
  id: true,
  projectId: true,
  title: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  sections: true,
  pdfBytes: true,
  error: true,
  shareToken: true,
  shareExpiresAt: true,
  generatedAt: true,
  createdAt: true,
  project: { select: { name: true, domain: true, client: { select: { name: true } } } },
} satisfies Prisma.ReportSelect;

export type ReportRow = Awaited<ReturnType<typeof listReports>>["items"][number];

/**
 * Saves a report and queues the worker to build it. Used by people and by schedules (Step 16).
 * `now` is a parameter so tests can control the date.
 */
export async function createReportRecord(
  agency: { agencyId: string },
  createdById: string | null,
  rawInput: unknown,
  options: {
    now?: Date;
    enqueue?: Enqueue;
    /** Set by the schedule dispatcher. The pair is unique, so a run is never made twice. */
    schedule?: { id: string; scheduledFor: Date };
  } = {},
) {
  const input = parseInput(reportSchema, rawInput);
  await assertNotReadOnly(agency);
  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      agencyId: agency.agencyId,
      deletedAt: null,
      client: { deletedAt: null },
    },
    select: { id: true, name: true, agency: { select: { timezone: true } } },
  });
  if (!project) throw new NotFoundError("Project not found.");

  let period;
  try {
    period = resolvePeriod(
      { kind: input.period as PeriodKind, start: input.start, end: input.end },
      { now: options.now ?? new Date(), timeZone: project.agency.timezone },
    );
  } catch (error) {
    if (error instanceof PeriodError) throw new ValidationError(error.message);
    throw error;
  }

  const sections = [...new Set(input.sections)] as ReportSectionKey[];
  const report = await db.report.create({
    data: {
      agencyId: agency.agencyId,
      projectId: project.id,
      title: input.title || `${project.name} report, ${period.label}`,
      periodStart: new Date(`${period.start}T00:00:00Z`),
      periodEnd: new Date(`${period.end}T00:00:00Z`),
      sections,
      notes: input.notes || null,
      createdById,
      scheduleId: options.schedule?.id,
      scheduledFor: options.schedule?.scheduledFor,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: agency.agencyId,
    actorUserId: createdById,
    action: "report.created",
    targetType: "Report",
    targetId: report.id,
    metadata: { projectId: project.id },
  });
  await (options.enqueue ?? enqueueReport)({ reportId: report.id, agencyId: agency.agencyId });
  return report;
}

export async function createReport(
  ctx: TenantContext,
  rawInput: unknown,
  options: { now?: Date; enqueue?: Enqueue } = {},
) {
  requireCreate(ctx);
  return createReportRecord(ctx, ctx.userId, rawInput, options);
}

export async function listReports(ctx: TenantContext, filter: Page & { projectId?: string } = {}) {
  requireView(ctx);
  const where: Prisma.ReportWhereInput = {
    agencyId: ctx.agencyId,
    ...(filter.projectId ? { projectId: filter.projectId } : {}),
  };
  const { take, skip } = paging(filter);
  const [items, total] = await Promise.all([
    db.report.findMany({
      where,
      select: reportSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip,
    }),
    db.report.count({ where }),
  ]);
  return { items, total, page: Math.floor(skip / take) + 1, pageSize: take };
}

export async function getReport(ctx: TenantContext, id: string) {
  requireView(ctx);
  const report = await db.report.findFirst({
    where: { id, agencyId: ctx.agencyId },
    select: { ...reportSelect, data: true },
  });
  if (!report) throw new NotFoundError("Report not found.");
  return { ...report, model: (report.data as ReportModel | null) ?? null };
}

export async function deleteReport(ctx: TenantContext, id: string) {
  requireCreate(ctx);
  const report = await db.report.findFirst({
    where: { id, agencyId: ctx.agencyId },
    select: { id: true, pdfKey: true },
  });
  if (!report) throw new NotFoundError("Report not found.");
  await db.report.deleteMany({ where: { id, agencyId: ctx.agencyId } });
  if (report.pdfKey) await getStorage().delete(report.pdfKey);
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report.deleted",
    targetType: "Report",
    targetId: id,
  });
}

/** Turns on (or renews) the public link. The link stops working after `days` days. */
export async function shareReport(ctx: TenantContext, rawInput: unknown, now = new Date()) {
  requireCreate(ctx);
  const input = parseInput(shareSchema, rawInput);
  const report = await db.report.findFirst({
    where: { id: input.reportId, agencyId: ctx.agencyId },
    select: { id: true, status: true, shareToken: true },
  });
  if (!report) throw new NotFoundError("Report not found.");
  if (report.status !== "READY") throw new ConflictError("The report is not ready yet.");
  const shareExpiresAt = new Date(now.getTime() + input.days * 86_400_000);
  const shareToken = report.shareToken ?? generateToken(24);
  await db.report.updateMany({
    where: { id: report.id, agencyId: ctx.agencyId },
    data: { shareToken, shareExpiresAt },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report.shared",
    targetType: "Report",
    targetId: report.id,
    metadata: { days: input.days },
  });
  return { shareToken, shareExpiresAt };
}

/** Turns the public link off. The old link stops working for good. */
export async function revokeShare(ctx: TenantContext, id: string) {
  requireCreate(ctx);
  const result = await db.report.updateMany({
    where: { id, agencyId: ctx.agencyId },
    data: { shareToken: null, shareExpiresAt: null },
  });
  if (result.count === 0) throw new NotFoundError("Report not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report.share_revoked",
    targetType: "Report",
    targetId: id,
  });
}

/** Reads the PDF for a report in this agency, or null when it has none. */
export async function readReportPdf(ctx: TenantContext, id: string) {
  if (!can(ctx.role, "reports.download")) throw new ForbiddenError();
  const report = await db.report.findFirst({
    where: { id, agencyId: ctx.agencyId, status: "READY" },
    select: { pdfKey: true, title: true, periodEnd: true },
  });
  if (!report?.pdfKey) return null;
  const file = await getStorage().get(report.pdfKey);
  return file ? { bytes: file.bytes, title: report.title, periodEnd: day(report.periodEnd) } : null;
}
