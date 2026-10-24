"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  addResearchToTracker,
  deleteKeywordList,
  removeListItems,
  saveToList,
  saveToListSchema,
} from "@/server/services/research";

const idSchema = z.string().min(1).max(100);

const save = withTenantAction(
  { permission: "content.edit", schema: saveToListSchema },
  (ctx, input) => saveToList(ctx, input),
);
const track = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({
      projectId: idSchema,
      phrases: z.array(z.string().max(100)).min(1).max(1000),
    }),
  },
  (ctx, input) => addResearchToTracker(ctx, input.projectId, input.phrases),
);
const removeItems = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ listId: idSchema, ids: z.array(idSchema).max(1000) }),
  },
  async (ctx, input) => ({ removed: await removeListItems(ctx, input.listId, input.ids) }),
);
const removeList = withTenantAction(
  { permission: "content.delete", schema: z.object({ listId: idSchema }) },
  (ctx, input) => deleteKeywordList(ctx, input.listId),
);

export async function saveToListAction(slug: string, input: unknown) {
  const result = await save(slug, input);
  if (result.ok) revalidatePath(`/app/${slug}/research`, "layout");
  return result;
}
export async function addToTrackerAction(slug: string, projectId: string, phrases: string[]) {
  const result = await track(slug, { projectId, phrases });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}`, "layout");
  return result;
}
export async function removeListItemsAction(slug: string, listId: string, ids: string[]) {
  const result = await removeItems(slug, { listId, ids });
  if (result.ok) revalidatePath(`/app/${slug}/research`, "layout");
  return result;
}
export async function deleteListAction(slug: string, listId: string) {
  const result = await removeList(slug, { listId });
  if (result.ok) revalidatePath(`/app/${slug}/research`, "layout");
  return result;
}
