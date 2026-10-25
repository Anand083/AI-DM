import "server-only";
import { z } from "zod";
import { getEnv } from "@/env";
import { runBillingTick } from "@/server/jobs/system/billing-tick";
import { rawDb } from "@/server/db/client";
import { NotFoundError } from "./errors";

export const advanceSchema = z.object({
  agency: z.string().min(1).max(100),
  days: z.number().min(0).max(800),
  failRenewal: z.boolean().optional(),
});

/** Billing time travel is for development and tests only. */
export function devBillingAllowed(): boolean {
  return getEnv().NODE_ENV !== "production";
}

const shift = (date: Date | null, ms: number) => (date ? new Date(date.getTime() - ms) : date);

/**
 * Moves an agency's subscription clock forward by `days`, by moving all its dates back, and then
 * runs the billing tick as of now. Used by tests to see trials end and renewals happen.
 */
export async function advanceBillingClock(input: z.infer<typeof advanceSchema>) {
  const agency = await rawDb.agency.findUnique({
    where: { slug: input.agency },
    select: { id: true },
  });
  if (!agency) throw new NotFoundError("Agency not found.");
  const sub = await rawDb.subscription.findFirst({ where: { agencyId: agency.id } });
  if (!sub) throw new NotFoundError("No subscription found.");
  const ms = input.days * 86_400_000;
  await rawDb.subscription.update({
    where: { id: sub.id },
    data: {
      trialEndsAt: shift(sub.trialEndsAt, ms),
      currentPeriodStart: shift(sub.currentPeriodStart, ms),
      currentPeriodEnd: shift(sub.currentPeriodEnd, ms),
      graceEndsAt: shift(sub.graceEndsAt, ms),
      ...(input.failRenewal !== undefined
        ? { providerMeta: { failRenewal: input.failRenewal } }
        : {}),
    },
  });
  return runBillingTick({ db: rawDb, now: new Date() });
}
