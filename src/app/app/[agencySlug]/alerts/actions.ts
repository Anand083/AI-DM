"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { markAlertRead, markAllAlertsRead } from "@/server/services/alerts";

const markOne = withTenantAction(
  { permission: "data.view", schema: z.object({ alertId: z.string().min(1).max(100) }) },
  (ctx, input) => markAlertRead(ctx, input.alertId),
);
const markAll = withTenantAction(
  { permission: "data.view", schema: z.object({}) },
  async (ctx) => ({
    marked: await markAllAlertsRead(ctx),
  }),
);

export async function markAlertReadAction(slug: string, alertId: string) {
  const result = await markOne(slug, { alertId });
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}

export async function markAllAlertsReadAction(slug: string) {
  const result = await markAll(slug, {});
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}
