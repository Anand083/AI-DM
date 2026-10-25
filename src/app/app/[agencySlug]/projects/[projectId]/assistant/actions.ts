"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { askAssistant, decideAssistantAction } from "@/server/services/assistant";

const idSchema = z.string().min(1).max(100);

const ask = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: idSchema, values: z.unknown() }) },
  (ctx, input) => askAssistant(ctx, input.projectId, input.values),
);
const decide = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({
      projectId: idSchema,
      actionId: idSchema,
      decision: z.enum(["approve", "dismiss"]),
    }),
  },
  (ctx, input) => decideAssistantAction(ctx, input.projectId, input.actionId, input.decision),
);

/** Saves a question; the worker writes the answer. The page refreshes itself until it is there. */
export async function askAssistantAction(slug: string, projectId: string, values: unknown) {
  const result = await ask(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/assistant`);
  return result;
}
export async function decideAssistantActionAction(
  slug: string,
  projectId: string,
  actionId: string,
  decision: "approve" | "dismiss",
) {
  const result = await decide(slug, { projectId, actionId, decision });
  revalidatePath(`/app/${slug}/projects/${projectId}/assistant`);
  if (result.ok) revalidatePath(`/app/${slug}/tasks`);
  return result;
}
