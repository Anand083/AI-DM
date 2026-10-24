import "server-only";
import type { UsageMetric } from "@prisma/client";
import {
  isLimitedMetric,
  METRIC_LABEL,
  METRIC_LIMIT_KEY,
  UNLIMITED,
  type LimitedMetric,
  type PlanLimits,
} from "@/lib/plan-limits";
import { subscriptionUsagePeriod, type UsagePeriod } from "@/lib/usage-period";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { ForbiddenError, LimitExceededError } from "./errors";

type AgencyRef = { agencyId: string };

export type AgencyPlan = {
  planName: string;
  limits: PlanLimits;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  period: UsagePeriod;
};

export async function getAgencyPlan(
  agency: AgencyRef,
  now: Date = new Date(),
): Promise<AgencyPlan> {
  const sub = await db.subscription.findFirst({
    where: { agencyId: agency.agencyId },
    select: {
      status: true,
      trialEndsAt: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      createdAt: true,
      plan: { select: { name: true, limits: true } },
    },
  });
  if (!sub) throw new Error(`Agency ${agency.agencyId} has no subscription`);
  return {
    planName: sub.plan.name,
    limits: sub.plan.limits as unknown as PlanLimits,
    status: sub.status,
    period: subscriptionUsagePeriod(sub, now),
  };
}

/** Units used per metric inside a period. */
export async function getUsageByMetric(
  agency: AgencyRef,
  period: UsagePeriod,
): Promise<Partial<Record<UsageMetric, number>>> {
  const rows = await db.usageRecord.groupBy({
    by: ["metric"],
    where: { agencyId: agency.agencyId, createdAt: { gte: period.start, lt: period.end } },
    _sum: { quantity: true },
  });
  return Object.fromEntries(rows.map((r) => [r.metric, r._sum.quantity ?? 0]));
}

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

/**
 * Throws LimitExceededError when using `quantity` more units of `metric` would go over the
 * plan limit for this period. Metrics without a plan limit always pass.
 */
export async function assertWithinLimit(
  agency: AgencyRef,
  metric: UsageMetric,
  quantity = 1,
  now: Date = new Date(),
): Promise<void> {
  const plan = await getAgencyPlan(agency, now);
  if (plan.status === "EXPIRED" || plan.status === "CANCELED") {
    throw new LimitExceededError("Your subscription has ended. Choose a plan to continue.");
  }
  if (!isLimitedMetric(metric)) return;
  const limit = plan.limits[METRIC_LIMIT_KEY[metric]];
  if (limit === UNLIMITED) return;
  const used = (await getUsageByMetric(agency, plan.period))[metric] ?? 0;
  if (used + quantity > limit) {
    const label = METRIC_LABEL[metric].plural;
    const remaining = Math.max(0, limit - used);
    const first =
      remaining > 0
        ? `This needs ${quantity} ${label}, but you only have ${remaining} left this month on your ${plan.planName} plan.`
        : `You have used all ${limit} ${label} for this month on your ${plan.planName} plan.`;
    throw new LimitExceededError(
      `${first} It resets on ${formatDate(plan.period.end)}. Upgrade your plan to get more.`,
    );
  }
}

export type UsageLine = {
  key: string;
  label: string;
  used: number;
  /** -1 means unlimited. */
  limit: number;
  percent: number;
};

export type UsageSummary = {
  planName: string;
  status: AgencyPlan["status"];
  period: UsagePeriod;
  /** Counted per month; resets on `period.end`. */
  monthly: UsageLine[];
  /** Counted as totals; do not reset. */
  totals: UsageLine[];
};

function line(key: string, label: string, used: number, limit: number): UsageLine {
  const percent =
    limit === UNLIMITED
      ? 0
      : limit === 0
        ? used > 0
          ? 100
          : 0
        : Math.min(100, Math.round((used / limit) * 100));
  return { key, label, used, limit, percent };
}

/** Everything the usage page shows. */
export async function getUsageSummary(
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<UsageSummary> {
  if (!can(ctx.role, "branding.edit")) throw new ForbiddenError();
  const plan = await getAgencyPlan(ctx, now);
  const usage = await getUsageByMetric(ctx, plan.period);

  const monthly = (Object.keys(METRIC_LIMIT_KEY) as LimitedMetric[]).map((metric) =>
    line(
      metric,
      capitalize(METRIC_LABEL[metric].plural),
      usage[metric] ?? 0,
      plan.limits[METRIC_LIMIT_KEY[metric]],
    ),
  );

  const [clients, projects, members, pendingInvites, clientUsers] = await Promise.all([
    db.client.count({ where: { agencyId: ctx.agencyId, deletedAt: null, status: "ACTIVE" } }),
    db.project.count({
      where: {
        agencyId: ctx.agencyId,
        deletedAt: null,
        client: { deletedAt: null, status: "ACTIVE" },
      },
    }),
    db.agencyMember.count({ where: { agencyId: ctx.agencyId } }),
    db.invitation.count({
      where: {
        agencyId: ctx.agencyId,
        acceptedAt: null,
        expiresAt: { gt: now },
        role: { in: ["ADMIN", "MEMBER"] },
      },
    }),
    db.clientUser.count({ where: { agencyId: ctx.agencyId } }),
  ]);

  const totals = [
    line("maxClients", "Clients", clients, plan.limits.maxClients),
    line("maxProjects", "Projects", projects, plan.limits.maxProjects),
    // Keywords are tracked from Step 10 on.
    line("maxKeywords", "Tracked keywords", 0, plan.limits.maxKeywords),
    line(
      "maxTeamMembers",
      "Team members (including invitations)",
      members + pendingInvites,
      plan.limits.maxTeamMembers,
    ),
    line("maxClientUsers", "Client users", clientUsers, plan.limits.maxClientUsers),
  ];

  return { planName: plan.planName, status: plan.status, period: plan.period, monthly, totals };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
