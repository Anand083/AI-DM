"use server";

import { revalidatePath } from "next/cache";
import { withTenantAction } from "@/server/auth/actions";
import { z } from "zod";
import {
  deleteAgency,
  deleteAgencySchema,
  updateAgencySchema,
  updateAgencySettings,
} from "@/server/services/agency";
import { setMyNotifications } from "@/server/services/notifications";
import { requestExport } from "@/server/services/data-export";

const update = withTenantAction(
  { permission: "branding.edit", schema: updateAgencySchema },
  (ctx, input) => updateAgencySettings(ctx, input),
);

export async function updateSettingsAction(slug: string, input: unknown) {
  const result = await update(slug, input);
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}

const exportData = withTenantAction(
  { permission: "agency.manage", schema: z.object({}) },
  async (ctx) => {
    await requestExport(ctx);
  },
);

const remove = withTenantAction(
  { permission: "agency.manage", schema: deleteAgencySchema },
  (ctx, input) => deleteAgency(ctx, input),
);

export async function requestExportAction(slug: string) {
  const result = await exportData(slug, {});
  if (result.ok) revalidatePath(`/app/${slug}/settings`);
  return result;
}

export async function deleteAgencyAction(slug: string, input: unknown) {
  const result = await remove(slug, input);
  if (result.ok) revalidatePath("/app", "layout");
  return result;
}

const myNotifications = withTenantAction(
  {
    permission: "data.view",
    schema: z.object({ digest: z.boolean().optional(), taskAssigned: z.boolean().optional() }),
  },
  (ctx, input) => setMyNotifications(ctx, input),
);

export async function setMyNotificationsAction(
  slug: string,
  change: { digest?: boolean; taskAssigned?: boolean },
) {
  const result = await myNotifications(slug, change);
  if (result.ok) revalidatePath(`/app/${slug}/settings`);
  return result;
}
