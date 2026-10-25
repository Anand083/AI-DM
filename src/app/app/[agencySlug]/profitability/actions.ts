"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { financeSettingsSchema, retainerSchema } from "@/lib/schemas/finance";
import { withTenantAction } from "@/server/auth/actions";
import { saveFinanceSettings, setClientRetainer } from "@/server/services/finance";

const settings = withTenantAction(
  { permission: "billing.manage", schema: financeSettingsSchema },
  (ctx, input) => saveFinanceSettings(ctx, input),
);
const retainer = withTenantAction(
  {
    permission: "billing.manage",
    schema: z.object({ clientId: z.string().min(1).max(100), values: retainerSchema }),
  },
  (ctx, input) => setClientRetainer(ctx, input.clientId, input.values),
);

export async function saveFinanceSettingsAction(slug: string, values: unknown) {
  const result = await settings(slug, values);
  if (result.ok) revalidatePath(`/app/${slug}/profitability`);
  return result;
}

export async function setRetainerAction(slug: string, clientId: string, values: unknown) {
  const result = await retainer(slug, { clientId, values });
  if (result.ok) revalidatePath(`/app/${slug}/profitability`);
  return result;
}
