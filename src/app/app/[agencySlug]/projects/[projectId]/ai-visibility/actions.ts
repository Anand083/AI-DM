"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  addPrompt,
  removePrompt,
  requestAiCheck,
  saveAiSettings,
} from "@/server/services/ai-visibility";

const idSchema = z.string().min(1).max(100);

const add = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: z.object({ text: z.string().max(500) }) }),
  },
  (ctx, input) => addPrompt(ctx, input.projectId, input.values),
);
const remove = withTenantAction(
  { permission: "content.edit", schema: z.object({ projectId: idSchema, promptId: idSchema }) },
  (ctx, input) => removePrompt(ctx, input.projectId, input.promptId),
);
const save = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({
      projectId: idSchema,
      values: z.object({
        brandName: z.string().max(200),
        engines: z.array(z.string().max(40)).max(10),
      }),
    }),
  },
  (ctx, input) => saveAiSettings(ctx, input.projectId, input.values),
);
const check = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: idSchema }) },
  (ctx, input) => requestAiCheck(ctx, input.projectId),
);

export async function addPromptAction(slug: string, projectId: string, values: unknown) {
  const result = await add(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/ai-visibility`);
  return result;
}
export async function removePromptAction(slug: string, projectId: string, promptId: string) {
  const result = await remove(slug, { projectId, promptId });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/ai-visibility`);
  return result;
}
export async function saveAiSettingsAction(slug: string, projectId: string, values: unknown) {
  const result = await save(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/ai-visibility`);
  return result;
}
/** Asks the worker to check the questions now. The page refreshes itself when it is done. */
export async function runAiCheckAction(slug: string, projectId: string) {
  return check(slug, { projectId });
}
