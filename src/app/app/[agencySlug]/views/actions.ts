"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { clientsBulkSchema, bulkSetClientsArchived } from "@/server/services/bulk";
import { bulkTasksSchema, bulkUpdateTasks } from "@/server/services/bulk";
import {
  createSavedView,
  dashboardPrefSchema,
  deleteSavedView,
  savedViewSchema,
  setHiddenDashboardParts,
} from "@/server/services/saved-views";

const saveView = withTenantAction(
  { permission: "data.view", schema: savedViewSchema },
  (ctx, input) => createSavedView(ctx, input),
);
const removeView = withTenantAction(
  { permission: "data.view", schema: z.object({ id: z.string().min(1).max(100) }) },
  (ctx, input) => deleteSavedView(ctx, input.id),
);
const dashboard = withTenantAction(
  { permission: "data.view", schema: dashboardPrefSchema },
  (ctx, input) => setHiddenDashboardParts(ctx, input),
);
const bulkClients = withTenantAction(
  { permission: "content.edit", schema: clientsBulkSchema },
  (ctx, input) => bulkSetClientsArchived(ctx, input),
);
const bulkTasks = withTenantAction(
  { permission: "content.edit", schema: bulkTasksSchema },
  (ctx, input) => bulkUpdateTasks(ctx, input),
);

export async function saveViewAction(slug: string, values: unknown) {
  const result = await saveView(slug, values);
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}
export async function deleteViewAction(slug: string, id: string) {
  const result = await removeView(slug, { id });
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}
export async function setDashboardPartsAction(slug: string, values: unknown) {
  const result = await dashboard(slug, values);
  if (result.ok) revalidatePath(`/app/${slug}`);
  return result;
}
export async function bulkClientsAction(slug: string, values: unknown) {
  const result = await bulkClients(slug, values);
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}
export async function bulkTasksAction(slug: string, values: unknown) {
  const result = await bulkTasks(slug, values);
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}
