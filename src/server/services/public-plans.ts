import "server-only";
import type { PlanLimits } from "@/lib/plan-limits";
import { rawDb } from "@/server/db/client";

export type PublicPlan = {
  code: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  limits: PlanLimits;
};

/** The plans shown on the pricing page: the public ones, cheapest first. Plans are not tied to an agency. */
export async function listPublicPlans(): Promise<PublicPlan[]> {
  const plans = await rawDb.plan.findMany({
    where: { isPublic: true },
    orderBy: [{ sortOrder: "asc" }, { priceMonthlyCents: "asc" }],
    take: 20,
  });
  return plans.map((p) => ({
    code: p.code,
    name: p.name,
    priceMonthlyCents: p.priceMonthlyCents,
    priceYearlyCents: p.priceYearlyCents,
    limits: p.limits as unknown as PlanLimits,
  }));
}
