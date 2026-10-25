"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { createAnnotation, deleteAnnotation } from "@/server/services/annotations";
import { createGoal, deleteGoal } from "@/server/services/goals";

const idSchema = z.string().min(1).max(100);
const withValues = z.object({ projectId: idSchema, values: z.unknown() });

const addGoal = withTenantAction({ permission: "content.edit", schema: withValues }, (ctx, input) =>
  createGoal(ctx, input.projectId, input.values),
);
const removeGoal = withTenantAction(
  { permission: "content.delete", schema: z.object({ projectId: idSchema, goalId: idSchema }) },
  (ctx, input) => deleteGoal(ctx, input.projectId, input.goalId),
);
const addNote = withTenantAction({ permission: "content.edit", schema: withValues }, (ctx, input) =>
  createAnnotation(ctx, input.projectId, input.values),
);
const removeNote = withTenantAction(
  { permission: "content.delete", schema: z.object({ id: idSchema }) },
  (ctx, input) => deleteAnnotation(ctx, input.id),
);

const refresh = (slug: string, projectId: string) =>
  revalidatePath(`/app/${slug}/projects/${projectId}/goals`);

export async function createGoalAction(slug: string, projectId: string, values: unknown) {
  const result = await addGoal(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function deleteGoalAction(slug: string, projectId: string, goalId: string) {
  const result = await removeGoal(slug, { projectId, goalId });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function createAnnotationAction(slug: string, projectId: string, values: unknown) {
  const result = await addNote(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function deleteAnnotationAction(slug: string, projectId: string, id: string) {
  const result = await removeNote(slug, { id });
  if (result.ok) refresh(slug, projectId);
  return result;
}
