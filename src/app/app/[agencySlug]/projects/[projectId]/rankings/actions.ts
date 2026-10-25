"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { getCheckNowStatus, requestCheckNow } from "@/server/services/check-now";
import { addKeywords, addKeywordsSchema, deleteKeywords } from "@/server/services/keywords";
import { bulkEditKeywords, importKeywordsCsv } from "@/server/services/keyword-insights";

const idSchema = z.string().min(1).max(100);

const add = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: addKeywordsSchema }),
  },
  (ctx, input) => addKeywords(ctx, input.projectId, input.values),
);
const remove = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, ids: z.array(idSchema).max(1000) }),
  },
  async (ctx, input) => ({ deleted: await deleteKeywords(ctx, input.projectId, input.ids) }),
);
const bulkEdit = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: z.unknown() }),
  },
  (ctx, input) => bulkEditKeywords(ctx, input.projectId, input.values),
);
const importCsv = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: z.unknown() }),
  },
  (ctx, input) => importKeywordsCsv(ctx, input.projectId, input.values),
);
const checkNow = withTenantAction(
  {
    permission: "tools.run",
    schema: z.object({ projectId: idSchema, keywordIds: z.array(idSchema).max(500).optional() }),
  },
  (ctx, input) => requestCheckNow(ctx, input.projectId, input.keywordIds),
);
const status = withTenantAction(
  { permission: "tools.run", schema: z.object({ jobId: z.string().min(1).max(200) }) },
  (ctx, input) => getCheckNowStatus(ctx, input.jobId),
);

/** Refreshes the pages after a check finished. Only a signed-in team member may ask for it. */
const finish = withTenantAction(
  { permission: "data.view", schema: z.object({ projectId: idSchema }) },
  async () => undefined,
);

function refresh(slug: string, projectId: string) {
  revalidatePath(`/app/${slug}/projects/${projectId}`, "layout");
}

export async function addKeywordsAction(slug: string, projectId: string, values: unknown) {
  const result = await add(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function bulkEditKeywordsAction(slug: string, projectId: string, values: unknown) {
  const result = await bulkEdit(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function importKeywordsAction(slug: string, projectId: string, values: unknown) {
  const result = await importCsv(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function deleteKeywordsAction(slug: string, projectId: string, ids: string[]) {
  const result = await remove(slug, { projectId, ids });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function checkNowAction(slug: string, projectId: string, keywordIds?: string[]) {
  return checkNow(slug, { projectId, keywordIds });
}
export async function checkNowStatusAction(slug: string, jobId: string) {
  return status(slug, { jobId });
}
export async function finishCheckNowAction(slug: string, projectId: string) {
  const result = await finish(slug, { projectId });
  if (result.ok) refresh(slug, projectId);
}
