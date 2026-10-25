import "server-only";
import { z } from "zod";
import { dateText } from "@/lib/date-text";
import {
  BUILT_IN_TEMPLATES,
  parseTemplateLines,
  templateDueDay,
  type TemplateItem,
} from "@/lib/tasks";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);
const MAX_TEMPLATES = 50;

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

export type TemplateView = { key: string; name: string; custom: boolean; items: TemplateItem[] };

/** The ready-made templates and the agency's own. Own templates use the key `custom:<id>`. */
export async function listTemplates(ctx: TenantContext): Promise<TemplateView[]> {
  requireView(ctx);
  const own = await db.taskTemplate.findMany({
    where: { agencyId: ctx.agencyId },
    select: { id: true, name: true, items: true },
    orderBy: { name: "asc" },
    take: MAX_TEMPLATES + 5,
  });
  return [
    ...BUILT_IN_TEMPLATES.map((t) => ({ ...t, custom: false })),
    ...own.map((t) => ({
      key: `custom:${t.id}`,
      name: t.name,
      custom: true,
      items: t.items as unknown as TemplateItem[],
    })),
  ];
}

export const templateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Write a name of at least 3 characters.")
    .max(80, "Keep the name under 80 characters."),
  lines: z.string().max(10_000, "That is too long."),
});

/** Saves a template written as one task a line (see `parseTemplateLines`). */
export async function createTemplate(ctx: TenantContext, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(templateSchema, raw);
  const { items, errors } = parseTemplateLines(input.lines);
  if (errors.length > 0) throw new ValidationError(errors.join(" "), { lines: errors.join(" ") });
  const count = await db.taskTemplate.count({ where: { agencyId: ctx.agencyId } });
  if (count >= MAX_TEMPLATES) {
    throw new LimitExceededError(
      `You can save up to ${MAX_TEMPLATES} templates. Delete one first.`,
    );
  }
  try {
    const created = await db.taskTemplate.create({
      data: { agencyId: ctx.agencyId, name: input.name, items: items as never },
      select: { id: true },
    });
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "task_template.created",
      targetType: "TaskTemplate",
      targetId: created.id,
    });
    return created;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new ConflictError("You already have a template with this name.");
    }
    throw error;
  }
}

export async function deleteTemplate(ctx: TenantContext, templateId: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  const result = await db.taskTemplate.deleteMany({
    where: { id: templateId, agencyId: ctx.agencyId },
  });
  if (result.count === 0) throw new NotFoundError("Template not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task_template.deleted",
    targetType: "TaskTemplate",
    targetId: templateId,
  });
}

export const applySchema = z.object({
  templateKey: z.string().min(1).max(120),
  projectId: z.string().min(1).max(100),
  startOn: dateText,
  assigneeId: z.string().min(1).max(100).nullable().default(null),
});

/** Makes the tasks of a template for a project. The due day of each is the start day plus its days. */
export async function applyTemplate(ctx: TenantContext, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(applySchema, raw);
  await getProject(ctx, input.projectId);
  const template = (await listTemplates(ctx)).find((t) => t.key === input.templateKey);
  if (!template) throw new NotFoundError("Template not found.");
  if (input.assigneeId) {
    const member = await db.agencyMember.findFirst({
      where: { agencyId: ctx.agencyId, userId: input.assigneeId },
      select: { id: true },
    });
    if (!member)
      throw new ValidationError("Choose a member of your team.", {
        assigneeId: "Choose a member of your team.",
      });
  }
  await db.task.createMany({
    data: template.items.map((item) => ({
      agencyId: ctx.agencyId,
      projectId: input.projectId,
      title: item.title,
      description: item.description,
      priority: item.priority,
      estimateMinutes: item.estimateMinutes,
      assigneeId: input.assigneeId,
      dueOn: new Date(`${templateDueDay(input.startOn, item.days)}T00:00:00Z`),
      createdById: ctx.userId,
    })),
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task_template.applied",
    targetType: "Project",
    targetId: input.projectId,
    metadata: { template: template.name, tasks: template.items.length, startOn: input.startOn },
  });
  return { created: template.items.length, today: day(new Date()) };
}
