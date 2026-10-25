import "server-only";
import type { Prisma, UsageMetric } from "@prisma/client";
import { z } from "zod";
import { grossMargin, microsToCents, monthlyEquivalentCents } from "@/lib/admin-metrics";
import { calendarMonth } from "@/lib/usage-period";
import { adminDb } from "@/server/db/admin-client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/services/errors";
import { paging, type Page } from "@/server/services/paging";
import type { AdminContext } from "./guard";

export type AgencyFilter = Page & {
  q?: string;
  status?: "ACTIVE" | "SUSPENDED";
  subscription?: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
};

export async function listAgencies(_admin: AdminContext, filter: AgencyFilter = {}) {
  const q = filter.q?.trim().slice(0, 100);
  const where: Prisma.AgencyWhereInput = {
    deletedAt: null,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.subscription ? { subscription: { is: { status: filter.subscription } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
            { members: { some: { user: { email: { contains: q, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
  const { take, skip } = paging(filter);
  const [items, total] = await Promise.all([
    adminDb.agency.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        subscription: { select: { status: true, plan: { select: { name: true } } } },
        _count: { select: { members: true, clients: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip,
    }),
    adminDb.agency.count({ where }),
  ]);
  return { items, total, page: Math.floor(skip / take) + 1, pageSize: take };
}

export async function getAgencyDetail(_admin: AdminContext, agencyId: string, now = new Date()) {
  const agency = await adminDb.agency.findFirst({
    where: { id: agencyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      timezone: true,
      createdAt: true,
      members: {
        select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ createdAt: "asc" }],
        take: 100,
      },
      subscription: { include: { plan: true } },
    },
  });
  if (!agency) throw new NotFoundError("Agency not found.");
  const month = calendarMonth(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [usage, daily, activity, counts] = await Promise.all([
    adminDb.usageRecord.groupBy({
      by: ["metric"],
      where: { agencyId, createdAt: { gte: month.start, lt: month.end } },
      _sum: { quantity: true, costMicros: true },
    }),
    adminDb.$queryRaw<{ day: Date; cost: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COALESCE(SUM("costMicros"), 0)::bigint AS cost
      FROM "UsageRecord"
      WHERE "agencyId" = ${agencyId} AND "createdAt" >= ${thirtyDaysAgo}
      GROUP BY 1 ORDER BY 1`,
    adminDb.activityLog.findMany({
      where: { agencyId },
      select: {
        id: true,
        action: true,
        actorUserId: true,
        impersonatorUserId: true,
        createdAt: true,
        metadata: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    Promise.all([
      adminDb.client.count({ where: { agencyId, deletedAt: null } }),
      adminDb.project.count({ where: { agencyId, deletedAt: null } }),
      adminDb.keyword.count({ where: { agencyId } }),
    ]),
  ]);

  const costMicros = usage.reduce((sum, u) => sum + (u._sum.costMicros ?? 0), 0);
  const sub = agency.subscription;
  const revenueCents =
    sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")
      ? monthlyEquivalentCents({
          interval: sub.interval,
          priceMonthlyCents: sub.plan.priceMonthlyCents,
          priceYearlyCents: sub.plan.priceYearlyCents,
        })
      : 0;
  return {
    ...agency,
    usage: usage.map((u) => ({
      metric: u.metric,
      quantity: u._sum.quantity ?? 0,
      costCents: microsToCents(u._sum.costMicros ?? 0),
    })),
    dailyCost: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      costCents: microsToCents(Number(d.cost)),
    })),
    margin: grossMargin(revenueCents, microsToCents(costMicros)),
    activity,
    totals: { clients: counts[0], projects: counts[1], keywords: counts[2] },
  };
}

async function log(
  admin: AdminContext,
  agencyId: string,
  action: string,
  metadata?: Prisma.InputJsonValue,
) {
  await adminDb.activityLog.create({
    data: {
      agencyId,
      actorUserId: admin.adminUserId,
      action,
      targetType: "Agency",
      targetId: agencyId,
      metadata,
    },
  });
}

async function mustFind(agencyId: string) {
  const agency = await adminDb.agency.findFirst({
    where: { id: agencyId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!agency) throw new NotFoundError("Agency not found.");
  return agency;
}

export async function setAgencySuspended(
  admin: AdminContext,
  agencyId: string,
  suspended: boolean,
) {
  const agency = await mustFind(agencyId);
  const status = suspended ? "SUSPENDED" : "ACTIVE";
  if (agency.status === status)
    throw new ConflictError(
      suspended ? "This agency is already suspended." : "This agency is not suspended.",
    );
  await adminDb.agency.update({ where: { id: agencyId }, data: { status } });
  await log(admin, agencyId, suspended ? "admin.suspended" : "admin.unsuspended");
  // Remove their sessions would be harsh; the suspended page shows on their next request.
}

/** Sets the plan without charging anything. For support and special deals. */
export async function changeAgencyPlan(admin: AdminContext, agencyId: string, planCode: string) {
  await mustFind(agencyId);
  const plan = await adminDb.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw new ValidationError("Choose one of the plans.");
  const sub = await adminDb.subscription.findFirst({ where: { agencyId }, select: { id: true } });
  if (!sub) throw new NotFoundError("This agency has no subscription.");
  await adminDb.subscription.update({
    where: { id: sub.id },
    data: { planId: plan.id, pendingPlanId: null, pendingInterval: null },
  });
  await log(admin, agencyId, "admin.plan_changed", { planCode });
}

export const extendTrialSchema = z.object({ days: z.number().int().min(1).max(365) });

/** Adds days to a trial. An ended trial starts again from now. */
export async function extendTrial(
  admin: AdminContext,
  agencyId: string,
  days: number,
  now = new Date(),
) {
  extendTrialSchema.parse({ days });
  await mustFind(agencyId);
  const sub = await adminDb.subscription.findFirst({ where: { agencyId } });
  if (!sub) throw new NotFoundError("This agency has no subscription.");
  if (sub.status !== "TRIALING" && !(sub.status === "EXPIRED" && sub.trialEndsAt)) {
    throw new ConflictError("Only a trial can be extended.");
  }
  const base =
    sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
  const trialEndsAt = new Date(base.getTime() + days * 86_400_000);
  await adminDb.subscription.update({
    where: { id: sub.id },
    data: { status: "TRIALING", trialEndsAt, trialReminder3At: null, trialReminder1At: null },
  });
  await log(admin, agencyId, "admin.trial_extended", {
    days,
    trialEndsAt: trialEndsAt.toISOString(),
  });
}

export const bonusSchema = z.object({
  metric: z.enum([
    "LIVE_CHECK",
    "AUDIT_PAGE",
    "KEYWORD_RESEARCH",
    "BACKLINK_QUERY",
    "AI_CHECK",
    "LEAD_AUDIT",
  ]),
  quantity: z.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(200).optional(),
});

/** Extra units for the current month. They add to the plan limit until the month resets. */
export async function addBonusUsage(admin: AdminContext, agencyId: string, rawInput: unknown) {
  const input = bonusSchema.parse(rawInput);
  await mustFind(agencyId);
  await adminDb.usageBonus.create({
    data: {
      agencyId,
      metric: input.metric as UsageMetric,
      quantity: input.quantity,
      note: input.note,
      createdBy: admin.adminUserId,
    },
  });
  await log(admin, agencyId, "admin.bonus_added", {
    metric: input.metric,
    quantity: input.quantity,
  });
}
