"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  createContentTasks,
  deleteContentUpdate,
  logContentUpdate,
} from "@/server/services/content";

const idSchema = z.string().min(1).max(100);
const withValues = z.object({ projectId: idSchema, values: z.unknown() });

const tasks = withTenantAction({ permission: "content.edit", schema: withValues }, (ctx, input) =>
  createContentTasks(ctx, input.projectId, input.values),
);
const log = withTenantAction({ permission: "content.edit", schema: withValues }, (ctx, input) =>
  logContentUpdate(ctx, input.projectId, input.values),
);
const remove = withTenantAction(
  { permission: "content.delete", schema: z.object({ projectId: idSchema, id: idSchema }) },
  (ctx, input) => deleteContentUpdate(ctx, input.projectId, input.id),
);

const refresh = (slug: string, projectId: string) =>
  revalidatePath(`/app/${slug}/projects/${projectId}/content`);

export async function createContentTasksAction(slug: string, projectId: string, values: unknown) {
  const result = await tasks(slug, { projectId, values });
  if (result.ok) {
    refresh(slug, projectId);
    revalidatePath(`/app/${slug}/tasks`);
  }
  return result;
}
export async function logContentUpdateAction(slug: string, projectId: string, values: unknown) {
  const result = await log(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function deleteContentUpdateAction(slug: string, projectId: string, id: string) {
  const result = await remove(slug, { projectId, id });
  if (result.ok) refresh(slug, projectId);
  return result;
}
