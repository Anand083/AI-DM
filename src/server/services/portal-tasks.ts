import "server-only";
import { z } from "zod";
import { progressPercent } from "@/lib/tasks";
import { can } from "@/server/auth/permissions";
import type { PortalContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { createAlerts } from "./alert-store";
import { logActivity } from "./activity";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";
import { projectWhere, reportWhere } from "./portal";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);

function requireView(ctx: PortalContext): void {
  if (!can(ctx.role, "data.view")) throw new ForbiddenError();
}

/** Tasks a client may see: the agency chose to show them, and they belong to the client's websites. */
function taskWhere(ctx: PortalContext, extra: object = {}) {
  return {
    agencyId: ctx.agencyId,
    clientVisible: true,
    project: projectWhere(ctx),
    ...extra,
  };
}

const portalTaskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueOn: true,
  approvalStatus: true,
  approvalNote: true,
  approvalAt: true,
  completedAt: true,
  project: { select: { id: true, name: true } },
} as const;

/** Never includes who the task is assigned to, internal comments, or anything about estimates. */
export async function listPortalTasks(
  ctx: PortalContext,
  filter: Page & { projectId?: string; open?: boolean } = {},
) {
  requireView(ctx);
  const { take, skip } = paging({ pageSize: 25, ...filter });
  const where = taskWhere(ctx, {
    ...(filter.projectId ? { projectId: filter.projectId } : {}),
    ...(filter.open ? { status: { not: "DONE" } } : {}),
  });
  const [rows, total, waiting] = await Promise.all([
    db.task.findMany({
      where,
      select: portalTaskSelect,
      orderBy: [{ dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.task.count({ where }),
    db.task.count({ where: taskWhere(ctx, { approvalStatus: "REQUESTED" }) }),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, dueOn: r.dueOn ? day(r.dueOn) : null })),
    total,
    waitingForApproval: waiting,
  };
}

export async function getPortalTask(ctx: PortalContext, taskId: string) {
  requireView(ctx);
  const task = await db.task.findFirst({
    where: taskWhere(ctx, { id: taskId }),
    select: portalTaskSelect,
  });
  if (!task) throw new NotFoundError("Task not found.");
  const comments = await db.taskComment.findMany({
    where: { agencyId: ctx.agencyId, taskId, clientVisible: true },
    select: { id: true, authorId: true, fromClient: true, body: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  const authors = await db.user.findMany({
    where: {
      id: { in: [...new Set(comments.map((c) => c.authorId).filter((x): x is string => !!x))] },
    },
    select: { id: true, name: true },
    take: 200,
  });
  const names = new Map(authors.map((a) => [a.id, a.name]));
  return {
    ...task,
    dueOn: task.dueOn ? day(task.dueOn) : null,
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      fromClient: c.fromClient,
      author: c.fromClient ? (c.authorId && names.get(c.authorId)) || "You" : "Your agency",
    })),
  };
}

/** Tells the agency's team that a client wrote or answered. One alert for each event. */
async function alertAgency(
  ctx: PortalContext,
  key: string,
  title: string,
  body: string,
  projectId: string | null,
) {
  try {
    await createAlerts(db, ctx.agencyId, [
      {
        projectId,
        type: "CLIENT_RESPONSE",
        severity: "INFO",
        title,
        body,
        data: {},
        dedupeKey: key,
      },
    ]);
  } catch (error) {
    logger.warn({ err: error }, "could not alert the agency about a client message");
  }
}

export const portalCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a comment.")
    .max(2000, "Keep the comment under 2000 characters."),
});

export async function commentOnTask(ctx: PortalContext, taskId: string, raw: unknown) {
  requireView(ctx);
  const input = parseInput(portalCommentSchema, raw);
  const task = await db.task.findFirst({
    where: taskWhere(ctx, { id: taskId }),
    select: { id: true, title: true, projectId: true },
  });
  if (!task) throw new NotFoundError("Task not found.");
  const comment = await db.taskComment.create({
    data: {
      agencyId: ctx.agencyId,
      taskId,
      authorId: ctx.userId,
      body: input.body,
      clientVisible: true,
      fromClient: true,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task.client_commented",
    targetType: "Task",
    targetId: taskId,
  });
  await alertAgency(
    ctx,
    `client_comment:${comment.id}`,
    "A client commented on a task",
    `On "${task.title}": ${input.body.slice(0, 140)}`,
    task.projectId,
  );
}

export const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "CHANGES"]),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters.").default(""),
});

/**
 * The client answers an approval request: approve, or ask for changes (a note is needed then).
 * Only a task that is waiting for an answer can be answered, and only once.
 */
export async function answerApproval(
  ctx: PortalContext,
  taskId: string,
  raw: unknown,
  now = new Date(),
) {
  requireView(ctx);
  const input = parseInput(decisionSchema, raw);
  if (input.decision === "CHANGES" && !input.note) {
    throw new ValidationError("Tell the agency what to change.", {
      note: "Tell the agency what to change.",
    });
  }
  const task = await db.task.findFirst({
    where: taskWhere(ctx, { id: taskId }),
    select: { id: true, title: true, projectId: true },
  });
  if (!task) throw new NotFoundError("Task not found.");
  const approved = input.decision === "APPROVE";
  const result = await db.task.updateMany({
    where: { id: taskId, agencyId: ctx.agencyId, approvalStatus: "REQUESTED" },
    data: {
      approvalStatus: approved ? "APPROVED" : "CHANGES_REQUESTED",
      approvalNote: input.note || null,
      approvalAt: now,
      approvalById: ctx.userId,
      // Asking for changes puts the work back in the team's hands.
      ...(approved ? {} : { status: "TODO", completedAt: null }),
    },
  });
  if (result.count === 0) throw new ValidationError("This task is not waiting for an answer.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: approved ? "task.approved" : "task.changes_requested",
    targetType: "Task",
    targetId: taskId,
  });
  await alertAgency(
    ctx,
    `client_approval:${taskId}:${now.getTime()}`,
    approved ? "A client approved a task" : "A client asked for changes",
    approved ? `"${task.title}" was approved.` : `"${task.title}": ${input.note.slice(0, 140)}`,
    task.projectId,
  );
}

/** Milestones and task counts of a website, for the client's progress view. */
export async function getPortalProgress(ctx: PortalContext, projectId: string) {
  requireView(ctx);
  const project = await db.project.findFirst({
    where: projectWhere(ctx, projectId),
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Website not found.");
  const [milestones, byStatus] = await Promise.all([
    db.milestone.findMany({
      where: { agencyId: ctx.agencyId, projectId, clientVisible: true },
      select: { id: true, title: true, dueOn: true, completedAt: true },
      orderBy: [{ dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 100,
    }),
    db.task.groupBy({
      by: ["status", "milestoneId"],
      where: taskWhere(ctx, { projectId }),
      _count: { _all: true },
      orderBy: [{ status: "asc" }, { milestoneId: "asc" }],
      take: 500,
    }),
  ]);
  const count = (pred: (r: (typeof byStatus)[number]) => boolean) =>
    byStatus.filter(pred).reduce((a, r) => a + r._count._all, 0);
  const total = count(() => true);
  const done = count((r) => r.status === "DONE");
  return {
    total,
    done,
    inProgress: count((r) => r.status === "IN_PROGRESS"),
    percent: progressPercent(done, total),
    milestones: milestones.map((m) => {
      const t = count((r) => r.milestoneId === m.id);
      const d = count((r) => r.milestoneId === m.id && r.status === "DONE");
      return {
        id: m.id,
        title: m.title,
        dueOn: m.dueOn ? day(m.dueOn) : null,
        reached: m.completedAt !== null,
        total: t,
        done: d,
        percent: progressPercent(d, t),
      };
    }),
  };
}

export async function listPortalReportComments(ctx: PortalContext, reportId: string) {
  if (!can(ctx.role, "reports.download")) throw new ForbiddenError();
  const report = await db.report.findFirst({
    where: reportWhere(ctx, { id: reportId }),
    select: { id: true },
  });
  if (!report) throw new NotFoundError("Report not found.");
  return listReportCommentRows(ctx.agencyId, reportId, ctx.userId);
}

export async function listReportCommentRows(agencyId: string, reportId: string, viewerId: string) {
  const rows = await db.reportComment.findMany({
    where: { agencyId, reportId },
    select: { id: true, authorId: true, fromClient: true, body: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  const ids = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    take: 200,
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    fromClient: r.fromClient,
    author: r.authorId === viewerId ? "You" : (r.authorId && names.get(r.authorId)) || "Someone",
  }));
}

export async function commentOnReport(ctx: PortalContext, reportId: string, raw: unknown) {
  if (!can(ctx.role, "reports.download")) throw new ForbiddenError();
  const input = parseInput(portalCommentSchema, raw);
  const report = await db.report.findFirst({
    where: reportWhere(ctx, { id: reportId }),
    select: { id: true, title: true, projectId: true },
  });
  if (!report) throw new NotFoundError("Report not found.");
  const comment = await db.reportComment.create({
    data: {
      agencyId: ctx.agencyId,
      reportId,
      authorId: ctx.userId,
      fromClient: true,
      body: input.body,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report.client_commented",
    targetType: "Report",
    targetId: reportId,
  });
  await alertAgency(
    ctx,
    `client_report_comment:${comment.id}`,
    "A client commented on a report",
    `On "${report.title}": ${input.body.slice(0, 140)}`,
    report.projectId,
  );
}
