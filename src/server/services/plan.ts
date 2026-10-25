import "server-only";
import { wouldExceed, type CountLimitKey, type PlanLimits } from "@/lib/plan-limits";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { LimitExceededError } from "./errors";

const NOUN: Record<CountLimitKey, [string, string]> = {
  maxClients: ["client", "clients"],
  maxProjects: ["project", "projects"],
  maxKeywords: ["keyword", "keywords"],
  maxTeamMembers: ["team member", "team members"],
  maxClientUsers: ["client user", "client users"],
  reportSchedules: ["report schedule", "report schedules"],
};

export async function getPlanLimits(
  ctx: TenantContext,
): Promise<{ planName: string; limits: PlanLimits }> {
  const subscription = await db.subscription.findFirst({
    where: { agencyId: ctx.agencyId },
    select: { plan: { select: { name: true, limits: true } } },
  });
  if (!subscription) throw new Error(`Agency ${ctx.agencyId} has no subscription`);
  return {
    planName: subscription.plan.name,
    limits: subscription.plan.limits as unknown as PlanLimits,
  };
}

/** Throws LimitExceededError when adding `adding` more would go over the plan limit. */
export async function assertCountWithinLimit(
  ctx: TenantContext,
  key: CountLimitKey,
  current: number,
  adding = 1,
): Promise<void> {
  const { planName, limits } = await getPlanLimits(ctx);
  const limit = limits[key];
  if (!wouldExceed(limit, current, adding)) return;
  const [one, many] = NOUN[key];
  throw new LimitExceededError(
    `Your ${planName} plan allows up to ${limit} ${limit === 1 ? one : many}. Upgrade your plan to add more.`,
  );
}
