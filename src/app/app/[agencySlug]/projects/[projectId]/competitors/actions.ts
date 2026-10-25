"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { addCompetitor, removeCompetitor, requestGapRefresh } from "@/server/services/competitors";
import { requestCompetitorLinks } from "@/server/services/competitor-insights";
import { addResearchToTracker } from "@/server/services/research";

const idSchema = z.string().min(1).max(100);

const add = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: z.object({ domain: z.string().max(300) }) }),
  },
  (ctx, input) => addCompetitor(ctx, input.projectId, input.values),
);
const remove = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, competitorId: idSchema }),
  },
  (ctx, input) => removeCompetitor(ctx, input.projectId, input.competitorId),
);
const refresh = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: idSchema }) },
  (ctx, input) => requestGapRefresh(ctx, input.projectId),
);
const refreshLinks = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: idSchema }) },
  (ctx, input) => requestCompetitorLinks(ctx, input.projectId),
);
const track = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({
      projectId: idSchema,
      phrases: z.array(z.string().max(100)).min(1).max(100),
    }),
  },
  (ctx, input) => addResearchToTracker(ctx, input.projectId, input.phrases),
);

export async function addCompetitorAction(slug: string, projectId: string, values: unknown) {
  const result = await add(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/competitors`);
  return result;
}
export async function removeCompetitorAction(
  slug: string,
  projectId: string,
  competitorId: string,
) {
  const result = await remove(slug, { projectId, competitorId });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/competitors`);
  return result;
}
/** Asks the worker to refresh the keyword gap. The page refreshes itself when it is done. */
export async function refreshGapAction(slug: string, projectId: string) {
  return refresh(slug, { projectId });
}
/** Asks the worker to read the competitors' link numbers. The page refreshes itself when it is done. */
export async function refreshCompetitorLinksAction(slug: string, projectId: string) {
  return refreshLinks(slug, { projectId });
}
export async function trackGapKeywordsAction(slug: string, projectId: string, phrases: string[]) {
  const result = await track(slug, { projectId, phrases });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}`, "layout");
  return result;
}
