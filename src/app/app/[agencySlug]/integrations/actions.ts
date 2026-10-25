"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createApiKeySchema } from "@/lib/api-keys";
import { withTenantAction } from "@/server/auth/actions";
import { enqueueWebhookTest } from "@/server/jobs/enqueue";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";
import {
  assertWebhookForTest,
  createWebhook,
  deleteWebhook,
  setWebhookEnabled,
  webhookSchema,
} from "@/server/services/webhooks";

const id = z.string().min(1).max(100);

const newKey = withTenantAction(
  { permission: "branding.edit", schema: createApiKeySchema },
  (ctx, input) => createApiKey(ctx, input),
);
const revoke = withTenantAction(
  { permission: "branding.edit", schema: z.object({ id }) },
  (ctx, input) => revokeApiKey(ctx, input.id),
);
const newHook = withTenantAction(
  { permission: "branding.edit", schema: webhookSchema },
  (ctx, input) => createWebhook(ctx, input),
);
const toggle = withTenantAction(
  { permission: "branding.edit", schema: z.object({ id, enabled: z.boolean() }) },
  (ctx, input) => setWebhookEnabled(ctx, input.id, input.enabled),
);
const remove = withTenantAction(
  { permission: "branding.edit", schema: z.object({ id }) },
  (ctx, input) => deleteWebhook(ctx, input.id),
);
const test = withTenantAction(
  { permission: "branding.edit", schema: z.object({ id }) },
  async (ctx, input) => {
    await assertWebhookForTest(ctx, input.id);
    await enqueueWebhookTest({ agencyId: ctx.agencyId, webhookId: input.id });
  },
);

const refresh = (slug: string) => revalidatePath(`/app/${slug}/integrations`);

export async function createApiKeyAction(slug: string, values: unknown) {
  const result = await newKey(slug, values);
  if (result.ok) refresh(slug);
  return result;
}
export async function revokeApiKeyAction(slug: string, keyId: string) {
  const result = await revoke(slug, { id: keyId });
  if (result.ok) refresh(slug);
  return result;
}
export async function createWebhookAction(slug: string, values: unknown) {
  const result = await newHook(slug, values);
  if (result.ok) refresh(slug);
  return result;
}
export async function setWebhookEnabledAction(slug: string, hookId: string, enabled: boolean) {
  const result = await toggle(slug, { id: hookId, enabled });
  if (result.ok) refresh(slug);
  return result;
}
export async function deleteWebhookAction(slug: string, hookId: string) {
  const result = await remove(slug, { id: hookId });
  if (result.ok) refresh(slug);
  return result;
}
export async function testWebhookAction(slug: string, hookId: string) {
  const result = await test(slug, { id: hookId });
  if (result.ok) refresh(slug);
  return result;
}
