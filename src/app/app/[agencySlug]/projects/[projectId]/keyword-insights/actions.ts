"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { requestKeywordMetrics } from "@/server/services/keyword-insights";

const refresh = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: z.string().min(1).max(100) }) },
  (ctx, input) => requestKeywordMetrics(ctx, input.projectId),
);

/** Asks the worker to read search volume and Bing positions. The page refreshes when it is done. */
export async function refreshKeywordMetricsAction(slug: string, projectId: string) {
  const result = await refresh(slug, { projectId });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/keyword-insights`);
  return result;
}
