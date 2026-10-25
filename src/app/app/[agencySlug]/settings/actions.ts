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
import { setMyDigest } from "@/server/services/notifications";
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

const myDigest = withTenantAction(
  { permission: "data.view", schema: z.object({ on: z.boolean() }) },
  (ctx, input) => setMyDigest(ctx, input.on),
);

export async function setMyDigestAction(slug: string, on: boolean) {
  const result = await myDigest(slug, { on });
  if (result.ok) revalidatePath(`/app/${slug}/settings`);
  return result;
}
