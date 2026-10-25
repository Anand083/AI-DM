"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  addTaskComment,
  createTask,
  createTaskFromIssue,
  deleteTask,
  updateTask,
} from "@/server/services/tasks";

const idSchema = z.string().min(1).max(100);

const create = withTenantAction(
  { permission: "content.edit", schema: z.object({ values: z.unknown() }) },
  (ctx, input) => createTask(ctx, input.values),
);
const update = withTenantAction(
  { permission: "content.edit", schema: z.object({ taskId: idSchema, values: z.unknown() }) },
  (ctx, input) => updateTask(ctx, input.taskId, input.values),
);
const comment = withTenantAction(
  { permission: "content.edit", schema: z.object({ taskId: idSchema, values: z.unknown() }) },
  (ctx, input) => addTaskComment(ctx, input.taskId, input.values),
);
const remove = withTenantAction(
  { permission: "content.delete", schema: z.object({ taskId: idSchema }) },
  (ctx, input) => deleteTask(ctx, input.taskId),
);
const fromIssue = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, auditId: idSchema, code: z.string().min(1).max(100) }),
  },
  (ctx, input) => createTaskFromIssue(ctx, input.projectId, input.auditId, input.code),
);

export async function createTaskAction(slug: string, values: unknown) {
  const result = await create(slug, { values });
  if (result.ok) revalidatePath(`/app/${slug}/tasks`);
  return result;
}
export async function updateTaskAction(slug: string, taskId: string, values: unknown) {
  const result = await update(slug, { taskId, values });
  if (result.ok) revalidatePath(`/app/${slug}/tasks`, "layout");
  return result;
}
export async function addCommentAction(slug: string, taskId: string, values: unknown) {
  const result = await comment(slug, { taskId, values });
  if (result.ok) revalidatePath(`/app/${slug}/tasks/${taskId}`);
  return result;
}
export async function deleteTaskAction(slug: string, taskId: string) {
  const result = await remove(slug, { taskId });
  if (result.ok) revalidatePath(`/app/${slug}/tasks`, "layout");
  return result;
}
export async function createTaskFromIssueAction(
  slug: string,
  projectId: string,
  auditId: string,
  code: string,
) {
  const result = await fromIssue(slug, { projectId, auditId, code });
  if (result.ok) revalidatePath(`/app/${slug}/tasks`);
  return result;
}
