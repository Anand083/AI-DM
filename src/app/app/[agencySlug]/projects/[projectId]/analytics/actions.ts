"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  chooseGoogleSources,
  choiceSchema,
  disconnectGoogle,
  requestGoogleSync,
} from "@/server/services/google";

const idSchema = z.string().min(1).max(100);

const choose = withTenantAction(
  { permission: "content.edit", schema: z.object({ projectId: idSchema, values: choiceSchema }) },
  (ctx, input) => chooseGoogleSources(ctx, input.projectId, input.values),
);
const sync = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: idSchema }) },
  (ctx, input) => requestGoogleSync(ctx, input.projectId),
);
const disconnect = withTenantAction(
  { permission: "content.edit", schema: z.object({ projectId: idSchema }) },
  (ctx, input) => disconnectGoogle(ctx, input.projectId),
);

export async function chooseSourcesAction(slug: string, projectId: string, values: unknown) {
  const result = await choose(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/analytics`);
  return result;
}
/** Asks the worker to read the latest numbers. The page refreshes itself when it is done. */
export async function syncGoogleAction(slug: string, projectId: string) {
  return sync(slug, { projectId });
}
export async function disconnectGoogleAction(slug: string, projectId: string) {
  const result = await disconnect(slug, { projectId });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/analytics`);
  return result;
}
