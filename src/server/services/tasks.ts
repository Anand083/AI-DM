import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  nextDueDay,
  priorityForSeverity,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUSES,
  type TaskRecurrence,
} from "@/lib/tasks";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { issueInfo } from "@/server/audit/issue-catalog";
import { logActivity } from "./activity";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";
import { getAudit, getIssueGroups } from "./audits";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);
const dayDate = (v: string) => new Date(`${v}T00:00:00Z`);

const oneOf = <T extends readonly { key: string }[]>(list: T) =>
  z.enum(list.map((x) => x.key) as [T[number]["key"], ...T[number]["key"][]]);

const dateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date like 2026-03-31.")
  .refine((v) => {
    // 31 February would roll over into March, so the date must survive a round trip.
    const t = Date.parse(`${v}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, "Enter a real date.");

export const taskFields = {
  title: z
    .string()
    .trim()
    .min(3, "Write a title of at least 3 characters.")
    .max(200, "Keep the title under 200 characters."),
  description: z.string().max(4000, "Keep the description under 4000 characters."),
  priority: oneOf(TASK_PRIORITIES),
  status: oneOf(TASK_STATUSES),
  assigneeId: z.string().min(1).max(100).nullable(),
  dueOn: dateText.nullable(),
  estimateMinutes: z
    .number()
    .int()
    .min(5, "Use at least 5 minutes.")
    .max(60 * 200, "Keep the estimate under 200 hours.")
    .nullable(),
  recurrence: oneOf(TASK_RECURRENCES),
  projectId: z.string().min(1).max(100).nullable(),
};

export const createTaskSchema = z.object({
  title: taskFields.title,
  description: taskFields.description.default(""),
  priority: taskFields.priority.default("MEDIUM"),
  assigneeId: taskFields.assigneeId.default(null),
  dueOn: taskFields.dueOn.default(null),
  estimateMinutes: taskFields.estimateMinutes.default(null),
  recurrence: taskFields.recurrence.default("NONE"),
  projectId: taskFields.projectId.default(null),
});

export const updateTaskSchema = z
  .object({
    title: taskFields.title,
    description: taskFields.description,
    priority: taskFields.priority,
    status: taskFields.status,
    assigneeId: taskFields.assigneeId,
    dueOn: taskFields.dueOn,
    estimateMinutes: taskFields.estimateMinutes,
    recurrence: taskFields.recurrence,
  })
  .partial();

export const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a comment.")
    .max(2000, "Keep the comment under 2000 characters."),
});

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

/** The assignee must be a member of this agency. */
async function checkAssignee(ctx: TenantContext, assigneeId: string | null): Promise<void> {
  if (!assigneeId) return;
  const member = await db.agencyMember.findFirst({
    where: { agencyId: ctx.agencyId, userId: assigneeId },
    select: { id: true },
  });
  if (!member) {
    throw new ValidationError("Choose a member of your team.", {
      assigneeId: "Choose a member of your team.",
    });
  }
}

const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  assigneeId: true,
  dueOn: true,
  estimateMinutes: true,
  recurrence: true,
  sourceAuditId: true,
  sourceIssueCode: true,
  completedAt: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

/** Members who can be given a task. */
export async function listAssignees(ctx: TenantContext) {
  requireView(ctx);
  const rows = await db.agencyMember.findMany({
    where: { agencyId: ctx.agencyId },
    select: { userId: true, user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return rows.map((r) => ({ id: r.userId, name: r.user.name }));
}

export async function createTask(ctx: TenantContext, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(createTaskSchema, raw);
  if (input.projectId) await getProject(ctx, input.projectId);
  await checkAssignee(ctx, input.assigneeId);
  const task = await db.task.create({
    data: {
      agencyId: ctx.agencyId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assigneeId: input.assigneeId,
      dueOn: input.dueOn ? dayDate(input.dueOn) : null,
      estimateMinutes: input.estimateMinutes,
      recurrence: input.recurrence,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task.created",
    targetType: "Task",
    targetId: task.id,
    metadata: { projectId: input.projectId },
  });
  return task;
}

/**
 * Makes a task from one issue group of an audit. The text comes from the issue catalog. If an open
 * task for the same issue already exists on the project, that one is returned and nothing is added.
 */
export async function createTaskFromIssue(
  ctx: TenantContext,
  projectId: string,
  auditId: string,
  code: string,
) {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  await getAudit(ctx, projectId, auditId);
  const group = (await getIssueGroups(ctx, projectId, auditId)).find((g) => g.code === code);
  if (!group) throw new NotFoundError("Issue not found in this audit.");

  const open = await db.task.findFirst({
    where: {
      agencyId: ctx.agencyId,
      projectId,
      sourceIssueCode: code,
      status: { not: "DONE" },
    },
    select: { id: true },
  });
  if (open) return { id: open.id, existing: true };

  const info = issueInfo(code);
  const sample = group.sampleUrls
    .slice(0, 5)
    .map((u) => `- ${u}`)
    .join("\n");
  const task = await db.task.create({
    data: {
      agencyId: ctx.agencyId,
      projectId,
      title: `Fix: ${info.title}`,
      description:
        `Found on ${group.count} ${group.count === 1 ? "page" : "pages"}.\n\n` +
        `Why it matters: ${info.why}\n\nHow to fix it: ${info.fix}\n\nExamples:\n${sample}`.slice(
          0,
          3900,
        ),
      priority: priorityForSeverity(info.severity),
      sourceAuditId: auditId,
      sourceIssueCode: code,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task.created",
    targetType: "Task",
    targetId: task.id,
    metadata: { projectId, auditId, issue: code },
  });
  return { id: task.id, existing: false };
}

export async function getTask(ctx: TenantContext, taskId: string) {
  requireView(ctx);
  const task = await db.task.findFirst({
    where: { id: taskId, agencyId: ctx.agencyId },
    select: taskSelect,
  });
  if (!task) throw new NotFoundError("Task not found.");
  const comments = await db.taskComment.findMany({
    where: { agencyId: ctx.agencyId, taskId },
    select: { id: true, authorId: true, body: true, createdAt: true },
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
      ...c,
      author: (c.authorId && names.get(c.authorId)) || "Someone",
    })),
  };
}

/**
 * Changes a task. Finishing a repeating task creates the next copy, due on its next day. Each
 * change is written to the activity log with the fields that changed.
 */
export async function updateTask(
  ctx: TenantContext,
  taskId: string,
  raw: unknown,
  now = new Date(),
) {
  requireEdit(ctx);
  const patch = parseInput(updateTaskSchema, raw);
  const current = await db.task.findFirst({
    where: { id: taskId, agencyId: ctx.agencyId },
    select: { ...taskSelect, projectId: true, createdById: true },
  });
  if (!current) throw new NotFoundError("Task not found.");
  if (patch.assigneeId !== undefined) await checkAssignee(ctx, patch.assigneeId);

  const data: Prisma.TaskUncheckedUpdateManyInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.assigneeId !== undefined) data.assigneeId = patch.assigneeId;
  if (patch.dueOn !== undefined) data.dueOn = patch.dueOn ? dayDate(patch.dueOn) : null;
  if (patch.estimateMinutes !== undefined) data.estimateMinutes = patch.estimateMinutes;
  if (patch.recurrence !== undefined) data.recurrence = patch.recurrence;
  const finishing = patch.status === "DONE" && current.status !== "DONE";
  if (patch.status !== undefined) {
    data.status = patch.status;
    data.completedAt = patch.status === "DONE" ? (current.completedAt ?? now) : null;
  }
  await db.task.updateMany({ where: { id: taskId, agencyId: ctx.agencyId }, data });

  let next: { id: string } | null = null;
  const recurrence = (patch.recurrence ?? current.recurrence) as TaskRecurrence;
  if (finishing && recurrence !== "NONE") {
    const dueOn =
      patch.dueOn !== undefined ? patch.dueOn : current.dueOn ? day(current.dueOn) : null;
    const nextDue = nextDueDay(dueOn, recurrence, day(now));
    next = await db.task.create({
      data: {
        agencyId: ctx.agencyId,
        projectId: current.projectId,
        title: patch.title ?? current.title,
        description: patch.description ?? current.description,
        priority: patch.priority ?? current.priority,
        assigneeId: patch.assigneeId !== undefined ? patch.assigneeId : current.assigneeId,
        estimateMinutes:
          patch.estimateMinutes !== undefined ? patch.estimateMinutes : current.estimateMinutes,
        recurrence,
        dueOn: nextDue ? dayDate(nextDue) : null,
        createdById: current.createdById,
      },
      select: { id: true },
    });
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: finishing ? "task.completed" : "task.updated",
    targetType: "Task",
    targetId: taskId,
    metadata: { fields: Object.keys(patch), ...(next ? { nextTaskId: next.id } : {}) },
  });
  return { nextTaskId: next?.id ?? null };
}

export async function addTaskComment(ctx: TenantContext, taskId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(commentSchema, raw);
  const task = await db.task.findFirst({
    where: { id: taskId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!task) throw new NotFoundError("Task not found.");
  await db.taskComment.create({
    data: { agencyId: ctx.agencyId, taskId, authorId: ctx.userId, body: input.body },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task.commented",
    targetType: "Task",
    targetId: taskId,
  });
}

export async function deleteTask(ctx: TenantContext, taskId: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  const result = await db.task.deleteMany({ where: { id: taskId, agencyId: ctx.agencyId } });
  if (result.count === 0) throw new NotFoundError("Task not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task.deleted",
    targetType: "Task",
    targetId: taskId,
  });
}

export const TASK_VIEWS = ["open", "mine", "overdue", "done"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

/** A page of tasks. Open tasks come first by due day (no due day last), then newest. */
export async function listTasks(
  ctx: TenantContext,
  filter: Page & { view?: TaskView; projectId?: string; q?: string } = {},
  now = new Date(),
) {
  requireView(ctx);
  const view = filter.view ?? "open";
  const today = dayDate(day(now));
  const q = filter.q?.trim().slice(0, 100);
  const where: Prisma.TaskWhereInput = {
    agencyId: ctx.agencyId,
    ...(filter.projectId ? { projectId: filter.projectId } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    ...(view === "done"
      ? { status: "DONE" }
      : view === "mine"
        ? { status: { not: "DONE" }, assigneeId: ctx.userId }
        : view === "overdue"
          ? { status: { not: "DONE" }, dueOn: { lt: today } }
          : { status: { not: "DONE" } }),
  };
  const { take, skip } = paging({ pageSize: 25, ...filter });
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      select: taskSelect,
      orderBy:
        view === "done"
          ? [{ completedAt: "desc" }, { id: "asc" }]
          : [{ dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.task.count({ where }),
  ]);
  const ids = [...new Set(rows.map((r) => r.assigneeId).filter((x): x is string => !!x))];
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    take: 200,
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    rows: rows.map((r) => ({
      ...r,
      dueOn: r.dueOn ? day(r.dueOn) : null,
      assignee: r.assigneeId ? (names.get(r.assigneeId) ?? "Former member") : null,
    })),
    total,
  };
}
