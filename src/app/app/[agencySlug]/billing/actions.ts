"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  cancelSubscription,
  changePlan,
  completeMockCheckout,
  resumeSubscription,
  startCheckout,
} from "@/server/services/billing";

const planInput = z.object({
  planCode: z.string().min(1).max(50),
  interval: z.enum(["MONTH", "YEAR"]),
});

const checkout = withTenantAction(
  { permission: "billing.manage", schema: planInput },
  async (ctx, input) => {
    const { url } = await startCheckout(ctx, input);
    return { url };
  },
);
const change = withTenantAction({ permission: "billing.manage", schema: planInput }, (ctx, input) =>
  changePlan(ctx, input),
);
const cancel = withTenantAction({ permission: "billing.manage", schema: z.object({}) }, (ctx) =>
  cancelSubscription(ctx),
);
const resume = withTenantAction({ permission: "billing.manage", schema: z.object({}) }, (ctx) =>
  resumeSubscription(ctx),
);
const finish = withTenantAction(
  {
    permission: "billing.manage",
    schema: z.object({ sessionId: z.string().min(1).max(100), outcome: z.enum(["pay", "fail"]) }),
  },
  (ctx, input) => completeMockCheckout(ctx, input.sessionId, input.outcome),
);

const refresh = (slug: string) => revalidatePath(`/app/${slug}`, "layout");

export async function startCheckoutAction(slug: string, values: unknown) {
  return checkout(slug, values);
}
export async function changePlanAction(slug: string, values: unknown) {
  const result = await change(slug, values);
  if (result.ok) refresh(slug);
  return result;
}
export async function cancelSubscriptionAction(slug: string) {
  const result = await cancel(slug, {});
  if (result.ok) refresh(slug);
  return result;
}
export async function resumeSubscriptionAction(slug: string) {
  const result = await resume(slug, {});
  if (result.ok) refresh(slug);
  return result;
}
export async function finishMockCheckoutAction(
  slug: string,
  sessionId: string,
  outcome: "pay" | "fail",
) {
  const result = await finish(slug, { sessionId, outcome });
  if (result.ok) refresh(slug);
  return result;
}
