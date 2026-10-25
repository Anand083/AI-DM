import "server-only";
import { z } from "zod";
import type { PlanLimits } from "@/lib/plan-limits";
import { adminDb } from "@/server/db/admin-client";
import { NotFoundError, ValidationError } from "@/server/services/errors";
import type { AdminContext } from "./guard";

const count = z.number().int().min(-1).max(10_000_000);

export const planLimitsSchema = z.object({
  maxClients: count,
  maxProjects: count,
  maxKeywords: count,
  maxTeamMembers: count,
  maxClientUsers: count,
  auditPagesPerMonth: count,
  keywordResearchPerMonth: count,
  liveChecksPerMonth: count,
  aiChecksPerMonth: count,
  backlinkQueriesPerMonth: count,
  leadAuditsPerMonth: count,
  reportSchedules: count,
  customDomain: z.boolean(),
  whiteLabel: z.boolean(),
}) satisfies z.ZodType<PlanLimits>;

export const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  priceMonthlyCents: z.number().int().min(0).max(10_000_000),
  priceYearlyCents: z.number().int().min(0).max(100_000_000),
  isPublic: z.boolean(),
  limits: planLimitsSchema,
});

export async function listPlansForAdmin(_admin: AdminContext) {
  const plans = await adminDb.plan.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { subscriptions: true } } },
    take: 50,
  });
  return plans.map((p) => ({ ...p, limits: p.limits as unknown as PlanLimits }));
}

/** Changes a plan. Existing subscribers get the new limits at once; -1 means unlimited. */
export async function updatePlan(_admin: AdminContext, planId: string, rawInput: unknown) {
  const parsed = planUpdateSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Please check the plan.");
  }
  const plan = await adminDb.plan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!plan) throw new NotFoundError("Plan not found.");
  await adminDb.plan.update({
    where: { id: planId },
    data: {
      name: parsed.data.name,
      priceMonthlyCents: parsed.data.priceMonthlyCents,
      priceYearlyCents: parsed.data.priceYearlyCents,
      isPublic: parsed.data.isPublic,
      limits: parsed.data.limits,
    },
  });
}
