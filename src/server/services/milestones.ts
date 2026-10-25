import "server-only";
import { z } from "zod";
import { dateText } from "@/lib/date-text";
import { progressPercent } from "@/lib/tasks";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError, LimitExceededError, NotFoundError } from "./errors";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);

export const milestoneSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Write a title of at least 3 characters.")
    .max(120, "Keep the title under 120 characters."),
  dueOn: dateText.nullable().default(null),
  clientVisible: z.boolean().default(true),
});

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

/** Milestones of a project with how many of their tasks are done. */
export async function listMilestones(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const rows = await db.milestone.findMany({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true, title: true, dueOn: true, completedAt: true, clientVisible: true },
    orderBy: [{ dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 100,
  });
  const counts = await db.task.groupBy({
    by: ["milestoneId", "status"],
    where: { agencyId: ctx.agencyId, projectId, milestoneId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
    orderBy: [{ milestoneId: "asc" }, { status: "asc" }],
    take: 500,
  });
  return rows.map((m) => {
    const mine = counts.filter((c) => c.milestoneId === m.id);
    const total = mine.reduce((a, c) => a + c._count._all, 0);
    const done = mine.filter((c) => c.status === "DONE").reduce((a, c) => a + c._count._all, 0);
    return {
      ...m,
      dueOn: m.dueOn ? day(m.dueOn) : null,
      total,
      done,
      percent: progressPercent(done, total),
    };
  });
}

export async function createMilestone(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(milestoneSchema, raw);
  await getProject(ctx, projectId);
  const count = await db.milestone.count({ where: { agencyId: ctx.agencyId, projectId } });
  if (count >= 100) {
    throw new LimitExceededError("A project can have up to 100 milestones.");
  }
  const created = await db.milestone.create({
    data: {
      agencyId: ctx.agencyId,
      projectId,
      title: input.title,
      dueOn: input.dueOn ? new Date(`${input.dueOn}T00:00:00Z`) : null,
      clientVisible: input.clientVisible,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "milestone.created",
    targetType: "Milestone",
    targetId: created.id,
    metadata: { projectId },
  });
  return created;
}

/** Marks a milestone reached, or opens it again. */
export async function setMilestoneDone(
  ctx: TenantContext,
  projectId: string,
  milestoneId: string,
  done: boolean,
  now = new Date(),
) {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  const result = await db.milestone.updateMany({
    where: { id: milestoneId, agencyId: ctx.agencyId, projectId },
    data: { completedAt: done ? now : null },
  });
  if (result.count === 0) throw new NotFoundError("Milestone not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: done ? "milestone.completed" : "milestone.reopened",
    targetType: "Milestone",
    targetId: milestoneId,
  });
}

/** Deletes a milestone. Its tasks stay, without a milestone. */
export async function deleteMilestone(ctx: TenantContext, projectId: string, milestoneId: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const result = await db.milestone.deleteMany({
    where: { id: milestoneId, agencyId: ctx.agencyId, projectId },
  });
  if (result.count === 0) throw new NotFoundError("Milestone not found.");
  await db.task.updateMany({
    where: { agencyId: ctx.agencyId, projectId, milestoneId },
    data: { milestoneId: null },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "milestone.deleted",
    targetType: "Milestone",
    targetId: milestoneId,
  });
}
