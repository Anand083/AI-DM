"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { requestReviewCheck, saveBusiness, unlinkBusiness } from "@/server/services/reviews";

const idSchema = z.string().min(1).max(100);

const save = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({
      projectId: idSchema,
      values: z.object({ name: z.string().max(300), city: z.string().max(300).optional() }),
    }),
  },
  (ctx, input) => saveBusiness(ctx, input.projectId, input.values),
);
const unlink = withTenantAction(
  { permission: "content.edit", schema: z.object({ projectId: idSchema }) },
  (ctx, input) => unlinkBusiness(ctx, input.projectId),
);
const check = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: idSchema }) },
  (ctx, input) => requestReviewCheck(ctx, input.projectId),
);

export async function saveBusinessAction(slug: string, projectId: string, values: unknown) {
  const result = await save(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/reviews`);
  return result;
}
export async function unlinkBusinessAction(slug: string, projectId: string) {
  const result = await unlink(slug, { projectId });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/reviews`);
  return result;
}
/** Asks the worker to read the reviews now. The page refreshes itself when it is done. */
export async function checkReviewsAction(slug: string, projectId: string) {
  return check(slug, { projectId });
}
