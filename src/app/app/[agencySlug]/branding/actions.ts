"use server";

import { revalidatePath } from "next/cache";
import { withTenantAction } from "@/server/auth/actions";
import { brandingSchema } from "@/lib/schemas/branding";
import { updateBranding } from "@/server/services/branding";

const update = withTenantAction(
  { permission: "branding.edit", schema: brandingSchema },
  (ctx, input) => updateBranding(ctx, input),
);

export async function updateBrandingAction(slug: string, values: unknown) {
  const result = await update(slug, values);
  if (result.ok) revalidatePath(`/app/${slug}`, "layout");
  return result;
}
