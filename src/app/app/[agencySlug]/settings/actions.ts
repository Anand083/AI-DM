"use server";

import { revalidatePath } from "next/cache";
import { withTenantAction } from "@/server/auth/actions";
import { updateAgencySchema, updateAgencySettings } from "@/server/services/agency";

const update = withTenantAction(
  { permission: "branding.edit", schema: updateAgencySchema },
  (ctx, input) => updateAgencySettings(ctx, input),
);

export async function updateSettingsAction(slug: string, input: unknown) {
  const result = await update(slug, input);
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}
