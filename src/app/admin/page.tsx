import type { Metadata } from "next";
import { StatCard } from "@/components/app/rank-widgets";
import { formatUsd } from "@/lib/admin-metrics";
import { getOverview } from "@/server/admin/overview";
import { requireSuperAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const admin = await requireSuperAdmin();
  const o = await getOverview(admin);
  const max = Math.max(1, ...o.signupsPerWeek.map((w) => w.count));
  return (
    <>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active agencies"
          value={String(o.agencies.active)}
          hint={`${o.agencies.suspended} suspended`}
        />
        <StatCard
          label="Paying customers"
          value={String(o.subscriptions.paying)}
          hint={`${o.subscriptions.trialing} on trial, ${o.subscriptions.pastDue} payment failed`}
        />
        <StatCard label="Monthly revenue (MRR)" value={formatUsd(o.mrrCents)} />
        <StatCard
          label="Churn, last 30 days"
          value={`${o.churnPercent}%`}
          hint={`${o.subscriptions.ended} ended in total`}
        />
        <StatCard
          label="Provider cost this month"
          value={formatUsd(o.providerCostCents)}
          hint={`Budget $${o.budget.budgetUsd} (${o.budget.percent}% used)`}
        />
        <StatCard
          label="Gross margin"
          value={formatUsd(o.margin.marginCents)}
          hint={o.margin.percent === null ? "No revenue yet" : `${o.margin.percent}% of revenue`}
        />
      </div>
      <section aria-labelledby="signups-h" className="space-y-2">
        <h2 id="signups-h" className="text-lg font-semibold">
          New agencies per week
        </h2>
        <ul className="space-y-1.5" aria-label="New agencies per week">
          {o.signupsPerWeek.map((w) => (
            <li key={w.week} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 tabular-nums">{w.week}</span>
              <span
                aria-hidden="true"
                className="h-4 rounded bg-zinc-900 dark:bg-zinc-100"
                style={{ width: `${w.count === 0 ? 0 : Math.max(2, (w.count / max) * 60)}%` }}
              />
              <span className="tabular-nums">{w.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
