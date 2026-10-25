import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgencyActions } from "@/components/admin/agency-actions";
import { StatCard } from "@/components/app/rank-widgets";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/admin-metrics";
import { getAgencyDetail } from "@/server/admin/agencies";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listPlansForAdmin } from "@/server/admin/plans";
import { NotFoundError } from "@/server/services/errors";

export const metadata: Metadata = { title: "Agency" };
export const dynamic = "force-dynamic";

export default async function AdminAgency({ params }: { params: Promise<{ agencyId: string }> }) {
  const admin = await requireSuperAdmin();
  const { agencyId } = await params;
  const agency = await getAgencyDetail(admin, agencyId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const plans = await listPlansForAdmin(admin);
  const sub = agency.subscription;
  const maxCost = Math.max(1, ...agency.dailyCost.map((d) => d.costCents));
  const owners = agency.members.filter((m) => m.role === "OWNER" || m.role === "ADMIN");

  return (
    <>
      <div>
        <Link href="/admin/agencies" className="text-sm underline underline-offset-4">
          All agencies
        </Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold">
          {agency.name}
          <Badge tone={agency.status === "ACTIVE" ? "success" : "danger"}>
            {agency.status.toLowerCase()}
          </Badge>
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {agency.slug} | {agency.timezone} | created {agency.createdAt.toISOString().slice(0, 10)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Plan"
          value={sub ? sub.plan.name : "None"}
          hint={
            sub
              ? `${sub.status.toLowerCase().replace("_", " ")}, ${sub.interval === "YEAR" ? "yearly" : "monthly"}`
              : undefined
          }
        />
        <StatCard label="Revenue per month" value={formatUsd(agency.margin.revenueCents)} />
        <StatCard label="Provider cost this month" value={formatUsd(agency.margin.costCents)} />
        <StatCard
          label="Margin"
          value={formatUsd(agency.margin.marginCents)}
          hint={agency.margin.percent === null ? "No revenue" : `${agency.margin.percent}%`}
        />
      </div>

      <AgencyActions
        agencyId={agency.id}
        suspended={agency.status === "SUSPENDED"}
        canExtendTrial={
          sub?.status === "TRIALING" || (sub?.status === "EXPIRED" && sub.trialEndsAt !== null)
        }
        planCode={sub?.plan.code ?? null}
        plans={plans.map((p) => ({ code: p.code, name: p.name }))}
        addOns={agency.addOns}
        owners={owners.map((m) => ({
          userId: m.user.id,
          label: `${m.user.name} (${m.role.toLowerCase()})`,
        }))}
      />

      <section aria-labelledby="members-h" className="space-y-2">
        <h2 id="members-h" className="text-lg font-semibold">
          Team
        </h2>
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {agency.members.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span>
                {m.user.name}{" "}
                <span className="text-zinc-600 dark:text-zinc-400">({m.user.email})</span>
              </span>
              <Badge>{m.role.toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {agency.totals.clients} clients, {agency.totals.projects} projects,{" "}
          {agency.totals.keywords} keywords.
        </p>
      </section>

      <section aria-labelledby="usage-h" className="space-y-2">
        <h2 id="usage-h" className="text-lg font-semibold">
          Usage and cost this month
        </h2>
        {agency.usage.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No usage yet.</p>
        ) : (
          <table className="w-full text-left text-sm" aria-label="Usage this month">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                {["Metric", "Units", "Provider cost"].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agency.usage.map((u) => (
                <tr key={u.metric}>
                  <td className="py-1 pr-3">{u.metric.toLowerCase().replace("_", " ")}</td>
                  <td className="py-1 pr-3 tabular-nums">{u.quantity.toLocaleString("en-US")}</td>
                  <td className="py-1 pr-3 tabular-nums">{formatUsd(u.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {agency.dailyCost.length > 0 ? (
          <ul className="space-y-1" aria-label="Provider cost per day, last 30 days">
            {agency.dailyCost.map((d) => (
              <li key={d.day} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 tabular-nums">{d.day}</span>
                <span
                  aria-hidden="true"
                  className="h-3 rounded bg-zinc-900 dark:bg-zinc-100"
                  style={{ width: `${Math.max(2, (d.costCents / maxCost) * 60)}%` }}
                />
                <span className="tabular-nums">{formatUsd(d.costCents)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="log-h" className="space-y-2">
        <h2 id="log-h" className="text-lg font-semibold">
          Activity log
        </h2>
        {agency.activity.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing yet.</p>
        ) : (
          <ul
            className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800"
            aria-label="Activity log"
          >
            {agency.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>
                  {a.action}
                  {a.impersonatorUserId ? (
                    <Badge tone="warning" className="ml-2">
                      by support
                    </Badge>
                  ) : null}
                </span>
                <time
                  className="text-zinc-600 dark:text-zinc-400"
                  dateTime={a.createdAt.toISOString()}
                >
                  {a.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
