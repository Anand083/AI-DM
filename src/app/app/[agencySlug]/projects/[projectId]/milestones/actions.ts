"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { createMilestone, deleteMilestone, setMilestoneDone } from "@/server/services/milestones";

const idSchema = z.string().min(1).max(100);

const create = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: z.unknown() }),
  },
  (ctx, input) => createMilestone(ctx, input.projectId, input.values),
);
const done = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, milestoneId: idSchema, done: z.boolean() }),
  },
  (ctx, input) => setMilestoneDone(ctx, input.projectId, input.milestoneId, input.done),
);
const remove = withTenantAction(
  {
    permission: "content.delete",
    schema: z.object({ projectId: idSchema, milestoneId: idSchema }),
  },
  (ctx, input) => deleteMilestone(ctx, input.projectId, input.milestoneId),
);

const refresh = (slug: string, projectId: string) =>
  revalidatePath(`/app/${slug}/projects/${projectId}/milestones`);

export async function createMilestoneAction(slug: string, projectId: string, values: unknown) {
  const result = await create(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function setMilestoneDoneAction(
  slug: string,
  projectId: string,
  milestoneId: string,
  isDone: boolean,
) {
  const result = await done(slug, { projectId, milestoneId, done: isDone });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function deleteMilestoneAction(slug: string, projectId: string, milestoneId: string) {
  const result = await remove(slug, { projectId, milestoneId });
  if (result.ok) refresh(slug, projectId);
  return result;
}
