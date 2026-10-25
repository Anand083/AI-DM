"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  removeCustomDomain,
  setCustomDomain,
  verifyCustomDomain,
} from "@/server/services/custom-domain";

const set = withTenantAction(
  { permission: "branding.edit", schema: z.object({ domain: z.string().max(300) }) },
  async (ctx, input) => {
    await setCustomDomain(ctx, input.domain);
  },
);
const verify = withTenantAction({ permission: "branding.edit", schema: z.object({}) }, (ctx) =>
  verifyCustomDomain(ctx),
);
const remove = withTenantAction({ permission: "branding.edit", schema: z.object({}) }, (ctx) =>
  removeCustomDomain(ctx),
);

const refresh = (slug: string) => revalidatePath(`/app/${slug}/branding`);

export async function setCustomDomainAction(slug: string, domain: string) {
  const result = await set(slug, { domain });
  if (result.ok) refresh(slug);
  return result;
}
export async function verifyCustomDomainAction(slug: string) {
  const result = await verify(slug, {});
  if (result.ok) refresh(slug);
  return result;
}
export async function removeCustomDomainAction(slug: string) {
  const result = await remove(slug, {});
  if (result.ok) refresh(slug);
  return result;
}
