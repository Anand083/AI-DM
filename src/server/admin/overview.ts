import "server-only";
import {
  churnPercent,
  computeMrr,
  countPerWeek,
  grossMargin,
  microsToCents,
} from "@/lib/admin-metrics";
import { calendarMonth } from "@/lib/usage-period";
import { adminDb } from "@/server/db/admin-client";
import { getBudget } from "@/server/services/budget-instance";
import type { AdminContext } from "./guard";

const DAY_MS = 86_400_000;

/** Platform-wide numbers for the admin home page. */
export async function getOverview(_admin: AdminContext, now = new Date()) {
  const month = calendarMonth(now);
  const since = new Date(now.getTime() - 8 * 7 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [agencyGroups, subs, signups, lostRecently, cost, budget] = await Promise.all([
    adminDb.agency.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    adminDb.subscription.findMany({
      select: {
        status: true,
        interval: true,
        plan: { select: { priceMonthlyCents: true, priceYearlyCents: true } },
      },
      take: 50_000,
    }),
    adminDb.agency.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
      take: 50_000,
    }),
    adminDb.subscription.count({
      where: {
        status: { in: ["CANCELED", "EXPIRED"] },
        updatedAt: { gte: thirtyDaysAgo },
        trialEndsAt: null,
      },
    }),
    adminDb.usageRecord.aggregate({
      where: { createdAt: { gte: month.start, lt: month.end } },
      _sum: { costMicros: true },
    }),
    getBudget().status({ fresh: true }),
  ]);

  const paying = subs.filter((s) => s.status === "ACTIVE" || s.status === "PAST_DUE").length;
  const mrrCents = computeMrr(
    subs.map((s) => ({
      status: s.status,
      interval: s.interval,
      priceMonthlyCents: s.plan.priceMonthlyCents,
      priceYearlyCents: s.plan.priceYearlyCents,
    })),
  );
  const costCents = microsToCents(cost._sum.costMicros ?? 0);
  const byStatus = (status: string) =>
    agencyGroups.find((g) => g.status === status)?._count._all ?? 0;

  return {
    agencies: { active: byStatus("ACTIVE"), suspended: byStatus("SUSPENDED") },
    subscriptions: {
      trialing: subs.filter((s) => s.status === "TRIALING").length,
      paying,
      pastDue: subs.filter((s) => s.status === "PAST_DUE").length,
      ended: subs.filter((s) => s.status === "CANCELED" || s.status === "EXPIRED").length,
    },
    mrrCents,
    // Paying customers lost in the last 30 days (paid accounts that ended) against everyone who was paying then.
    churnPercent: churnPercent(lostRecently, paying + lostRecently),
    signupsPerWeek: countPerWeek(
      signups.map((s) => s.createdAt),
      now,
      8,
    ),
    providerCostCents: costCents,
    budget,
    margin: grossMargin(mrrCents, costCents),
  };
}
