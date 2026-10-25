import "server-only";
import type { Prisma } from "@prisma/client";
import { nextRunAt } from "@/lib/report-schedule";
import {
  reportScheduleSchema,
  scheduleIdSchema,
  scheduleToggleSchema,
} from "@/lib/schemas/report-schedule";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { paging, type Page } from "./paging";
import { assertCountWithinLimit } from "./plan";
import { parseInput } from "./validation";

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireManage(ctx: TenantContext): void {
  if (!can(ctx.role, "reports.create")) throw new ForbiddenError();
}

const scheduleSelect = {
  id: true,
  projectId: true,
  frequency: true,
  dayOfWeek: true,
  dayOfMonth: true,
  hour: true,
  recipients: true,
  sections: true,
  enabled: true,
  nextRunAt: true,
  lastRunAt: true,
  project: { select: { name: true, client: { select: { name: true } } } },
} satisfies Prisma.ReportScheduleSelect;

export async function listSchedules(ctx: TenantContext, p: Page = {}) {
  requireView(ctx);
  const { take, skip } = paging(p);
  const where = { agencyId: ctx.agencyId };
  const [items, total] = await Promise.all([
    db.reportSchedule.findMany({
      where,
      select: scheduleSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip,
    }),
    db.reportSchedule.count({ where }),
  ]);
  return { items, total, page: Math.floor(skip / take) + 1, pageSize: take };
}

async function projectTimezone(ctx: TenantContext, projectId: string): Promise<string> {
  const project = await db.project.findFirst({
    where: { id: projectId, agencyId: ctx.agencyId, deletedAt: null, client: { deletedAt: null } },
    select: { agency: { select: { timezone: true } } },
  });
  if (!project) throw new NotFoundError("Project not found.");
  return project.agency.timezone;
}

/** One schedule per project. The first run is the next matching time after now. */
export async function createSchedule(ctx: TenantContext, rawInput: unknown, now = new Date()) {
  requireManage(ctx);
  const input = parseInput(reportScheduleSchema, rawInput);
  const timeZone = await projectTimezone(ctx, input.projectId);
  if (
    await db.reportSchedule.findFirst({
      where: { agencyId: ctx.agencyId, projectId: input.projectId },
      select: { id: true },
    })
  ) {
    throw new ConflictError("This project already has a schedule. Edit it instead.");
  }
  await assertCountWithinLimit(
    ctx,
    "reportSchedules",
    await db.reportSchedule.count({ where: { agencyId: ctx.agencyId } }),
  );
  const schedule = await db.reportSchedule.create({
    data: {
      agencyId: ctx.agencyId,
      projectId: input.projectId,
      frequency: input.frequency,
      dayOfWeek: input.dayOfWeek,
      dayOfMonth: input.dayOfMonth,
      hour: input.hour,
      recipients: input.recipients,
      sections: [...new Set(input.sections)],
      enabled: input.enabled,
      nextRunAt: nextRunAt(input, now, timeZone),
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report_schedule.created",
    targetType: "ReportSchedule",
    targetId: schedule.id,
  });
  return schedule;
}

export async function updateSchedule(
  ctx: TenantContext,
  scheduleId: string,
  rawInput: unknown,
  now = new Date(),
) {
  requireManage(ctx);
  const input = parseInput(reportScheduleSchema, rawInput);
  const existing = await db.reportSchedule.findFirst({
    where: { id: scheduleId, agencyId: ctx.agencyId },
    select: { id: true, projectId: true },
  });
  if (!existing) throw new NotFoundError("Schedule not found.");
  const timeZone = await projectTimezone(ctx, existing.projectId);
  await db.reportSchedule.updateMany({
    where: { id: scheduleId, agencyId: ctx.agencyId },
    data: {
      frequency: input.frequency,
      dayOfWeek: input.dayOfWeek,
      dayOfMonth: input.dayOfMonth,
      hour: input.hour,
      recipients: input.recipients,
      sections: [...new Set(input.sections)],
      enabled: input.enabled,
      nextRunAt: nextRunAt(input, now, timeZone),
    },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report_schedule.updated",
    targetType: "ReportSchedule",
    targetId: scheduleId,
  });
}

/** Turning a schedule on starts from now, so it does not send a pile of missed reports. */
export async function setScheduleEnabled(ctx: TenantContext, rawInput: unknown, now = new Date()) {
  requireManage(ctx);
  const input = parseInput(scheduleToggleSchema, rawInput);
  const existing = await db.reportSchedule.findFirst({
    where: { id: input.scheduleId, agencyId: ctx.agencyId },
    select: {
      id: true,
      projectId: true,
      frequency: true,
      dayOfWeek: true,
      dayOfMonth: true,
      hour: true,
    },
  });
  if (!existing) throw new NotFoundError("Schedule not found.");
  const timeZone = await projectTimezone(ctx, existing.projectId);
  await db.reportSchedule.updateMany({
    where: { id: existing.id, agencyId: ctx.agencyId },
    data: { enabled: input.enabled, nextRunAt: nextRunAt(existing, now, timeZone) },
  });
}

export async function deleteSchedule(ctx: TenantContext, rawInput: unknown) {
  requireManage(ctx);
  const { scheduleId } = parseInput(scheduleIdSchema, rawInput);
  const result = await db.reportSchedule.deleteMany({
    where: { id: scheduleId, agencyId: ctx.agencyId },
  });
  if (result.count === 0) throw new NotFoundError("Schedule not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report_schedule.deleted",
    targetType: "ReportSchedule",
    targetId: scheduleId,
  });
}
