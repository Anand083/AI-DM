import type { Metadata } from "next";
import Link from "next/link";
import { ChangeBadge, StatCard } from "@/components/app/rank-widgets";
import { ScoreBadge } from "@/components/app/audit-widgets";
import { UsageBars } from "@/components/app/usage-bars";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { pageFromParams, Pagination } from "@/components/ui/pagination";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getAgency } from "@/server/services/agency";
import { getDashboard } from "@/server/services/dashboard";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const SEVERITY_TONE = { INFO: "neutral", WARNING: "warning", CRITICAL: "danger" } as const;

export default async function AgencyHome({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const page = pageFromParams(sp.page);
  const [agency, data] = await Promise.all([
    getAgency(ctx),
    getDashboard(ctx, { page, pageSize: PAGE_SIZE }),
  ]);
  const base = `/app/${agencySlug}`;
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: agency.timezone }).format(d);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{agency.name}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clients" value={String(data.clientTotal)} />
        <StatCard label="Projects" value={String(data.projectTotal)} />
        <StatCard label="Tracked keywords" value={String(data.keywordTotal)} />
        <StatCard label="Unread alerts" value={String(data.unreadTotal)} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="clients-heading" className="space-y-3">
          <h2 id="clients-heading" className="text-lg font-semibold">
            Clients
          </h2>
          {data.rows.length === 0 ? (
            <EmptyState
              title="No clients yet"
              description="Add a client and a project to see rankings and audit scores here."
              action={
                can(ctx.role, "content.edit") ? (
                  <Link href={`${base}/clients/new`} className="text-sm underline">
                    Add your first client
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm" aria-label="Clients overview">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Client
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Average position
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        This week
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Audit score
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Alerts
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {data.rows.map((c) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2">
                          <Link
                            href={`${base}/clients/${c.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {c.name}
                          </Link>
                          <div className="text-xs text-zinc-600 dark:text-zinc-400">
                            {c.projects} {c.projects === 1 ? "project" : "projects"}, {c.keywords}{" "}
                            {c.keywords === 1 ? "keyword" : "keywords"}
                          </div>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{c.averagePosition ?? "-"}</td>
                        <td className="px-3 py-2">
                          {c.weeklyChange === null ? (
                            <span className="text-zinc-500">-</span>
                          ) : (
                            <ChangeBadge change={c.weeklyChange} />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.auditScore === null ? (
                            "-"
                          ) : (
                            <ScoreBadge score={c.auditScore} size="sm" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.unreadAlerts > 0 ? (
                            <Badge tone="danger">{c.unreadAlerts} unread</Badge>
                          ) : (
                            <span className="text-zinc-500">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                basePath={base}
                page={page}
                pageSize={PAGE_SIZE}
                total={data.clientTotal}
              />
            </>
          )}
        </section>

        <div className="space-y-8">
          <section aria-labelledby="alerts-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="alerts-heading" className="text-lg font-semibold">
                Latest alerts
              </h2>
              <Link href={`${base}/alerts`} className="text-sm underline-offset-4 hover:underline">
                See all
              </Link>
            </div>
            {data.recentAlerts.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Nothing yet. Alerts show up here when rankings move a lot.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {data.recentAlerts.map((a) => (
                  <li key={a.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone={SEVERITY_TONE[a.severity]}>
                        {a.severity === "CRITICAL"
                          ? "Important"
                          : a.severity === "WARNING"
                            ? "Warning"
                            : "Good news"}
                      </Badge>
                      {a.readAt === null ? <span className="text-xs font-medium">New</span> : null}
                    </div>
                    <p className={a.readAt === null ? "font-medium" : undefined}>{a.title}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.usage ? (
            <section aria-labelledby="usage-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 id="usage-heading" className="text-lg font-semibold">
                  Plan usage
                </h2>
                <Link href={`${base}/usage`} className="text-sm underline-offset-4 hover:underline">
                  Details
                </Link>
              </div>
              {data.usage.lines.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  You have not used much of your {data.usage.planName} plan yet.
                </p>
              ) : (
                <>
                  <UsageBars lines={data.usage.lines} />
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Monthly counts reset on {date(data.usage.resetsOn)}.
                  </p>
                </>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
