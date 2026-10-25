import type { Metadata } from "next";
import Link from "next/link";
import { CheckBacklinksButton } from "@/components/app/check-backlinks-button";
import { StatCard } from "@/components/app/rank-widgets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { REASON_LABELS } from "@/lib/backlink-math";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import {
  BACKLINK_FILTERS,
  getBacklinkOverview,
  listBacklinks,
  type BacklinkFilter,
} from "@/server/services/backlinks";

export const metadata: Metadata = { title: "Backlinks" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const FILTER_LABELS: Record<BacklinkFilter, string> = {
  active: "Active",
  new: "New",
  lost: "Lost",
  suspicious: "Suspicious",
};

const dayText = (d: Date | string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    typeof d === "string" ? new Date(`${d}T00:00:00Z`) : d,
  );
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default async function BacklinksPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const asked = typeof sp.filter === "string" ? sp.filter : "";
  const filter = BACKLINK_FILTERS.includes(asked as BacklinkFilter)
    ? (asked as BacklinkFilter)
    : "active";
  const page = pageFromParams(sp.page);
  const [overview, list] = await Promise.all([
    getBacklinkOverview(ctx, projectId),
    listBacklinks(ctx, projectId, filter, { page, pageSize: PAGE_SIZE }),
  ]);
  const base = `/app/${agencySlug}/projects/${projectId}/backlinks`;
  const canRun = can(ctx.role, "tools.run");
  const { latest, change } = overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Backlinks</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Links from other websites to this site. We check them once a week.
            {latest ? ` Last checked ${dayText(latest.takenOn)}.` : ""}
          </p>
        </div>
        {canRun ? (
          <CheckBacklinksButton
            agencySlug={agencySlug}
            projectId={projectId}
            label={latest ? "Check again" : "Check backlinks"}
            checkedToday={overview.checkedToday}
          />
        ) : null}
      </div>

      {!latest ? (
        <EmptyState
          title="No backlink data yet"
          description="Run the first check to see who links to this website."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total backlinks"
              value={latest.totalBacklinks.toLocaleString("en-US")}
              hint={change ? `${signed(change.backlinks)} since the check before` : undefined}
            />
            <StatCard
              label="Referring domains"
              value={latest.referringDomains.toLocaleString("en-US")}
              hint={
                change ? `${signed(change.referringDomains)} since the check before` : undefined
              }
            />
            <StatCard label="Domain rating" value={`${latest.domainRating} / 100`} />
            <StatCard label="Dofollow links" value={`${latest.dofollowPercent}%`} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="New since the check before"
              value={String(latest.newLinks)}
              hint={change ? undefined : "Shown after the second check"}
            />
            <StatCard
              label="Lost since the check before"
              value={String(latest.lostLinks)}
              hint={change ? undefined : "Shown after the second check"}
            />
            <StatCard
              label="Suspicious links"
              value={String(overview.suspicious)}
              hint="Spammy domain, very low rating, or an anchor that matches a tracked keyword"
            />
          </div>

          {overview.history.length > 1 ? (
            <section aria-labelledby="history-heading" className="space-y-2">
              <h3 id="history-heading" className="text-base font-semibold">
                Weekly history
              </h3>
              <div
                role="region"
                aria-label="Weekly history table"
                tabIndex={0}
                className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <table className="w-full text-left text-sm" aria-label="Weekly history">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      {["Checked", "Backlinks", "Referring domains", "New", "Lost"].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overview.history.map((h) => (
                      <tr
                        key={h.takenOn}
                        className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                      >
                        <td className="px-4 py-2">{dayText(h.takenOn)}</td>
                        <td className="px-4 py-2 tabular-nums">
                          {h.totalBacklinks.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          {h.referringDomains.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{h.newLinks}</td>
                        <td className="px-4 py-2 tabular-nums">{h.lostLinks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="links-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="links-heading" className="text-base font-semibold">
                Links
              </h3>
              <a
                href={`${base}/export?filter=${filter}`}
                className="text-sm underline-offset-4 hover:underline"
              >
                Download CSV
              </a>
            </div>
            <nav
              aria-label="Filter links"
              className="flex flex-wrap gap-4 border-b border-zinc-200 dark:border-zinc-800"
            >
              {BACKLINK_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={f === "active" ? base : `${base}?filter=${f}`}
                  aria-current={f === filter ? "page" : undefined}
                  className={
                    f === filter
                      ? "-mb-px border-b-2 border-zinc-900 px-1 py-2 text-sm font-medium dark:border-zinc-100"
                      : "-mb-px border-b-2 border-transparent px-1 py-2 text-sm text-zinc-600 hover:border-zinc-300 dark:text-zinc-400"
                  }
                >
                  {FILTER_LABELS[f]}
                </Link>
              ))}
            </nav>

            {list.rows.length === 0 ? (
              <EmptyState
                title={`No ${FILTER_LABELS[filter].toLowerCase()} links`}
                description={
                  filter === "new"
                    ? "New links show here once there are two checks to compare."
                    : "Nothing to show for this filter."
                }
              />
            ) : (
              <>
                <div
                  role="region"
                  aria-label="Backlinks list"
                  tabIndex={0}
                  className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <table className="w-full text-left text-sm" aria-label="Backlinks">
                    <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                      <tr>
                        {[
                          "Source",
                          "Points to",
                          "Anchor",
                          "Type",
                          "Rating",
                          "First seen",
                          filter === "lost" ? "Lost on" : "Last seen",
                          "Flags",
                        ].map((h) => (
                          <th key={h} scope="col" className="px-4 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.rows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900"
                        >
                          <td className="max-w-xs px-4 py-2">
                            <p className="font-medium">{r.sourceDomain}</p>
                            <p
                              className="truncate text-xs text-zinc-600 dark:text-zinc-400"
                              title={r.sourceUrl}
                            >
                              {r.sourceUrl}
                            </p>
                          </td>
                          <td className="max-w-[12rem] truncate px-4 py-2" title={r.targetUrl}>
                            {r.targetUrl.replace(/^https?:\/\//, "")}
                          </td>
                          <td className="px-4 py-2">{r.anchor}</td>
                          <td className="px-4 py-2">
                            <Badge tone={r.dofollow ? "success" : "neutral"}>
                              {r.dofollow ? "Dofollow" : "Nofollow"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 tabular-nums">{r.sourceRating}</td>
                          <td className="whitespace-nowrap px-4 py-2">{dayText(r.firstSeen)}</td>
                          <td className="whitespace-nowrap px-4 py-2">
                            {dayText(filter === "lost" && r.lostAt ? r.lostAt : r.lastSeen)}
                          </td>
                          <td className="px-4 py-2">
                            {r.suspicious ? (
                              <ul className="space-y-1">
                                {r.suspiciousReasons.map((reason) => (
                                  <li key={reason}>
                                    <Badge tone="warning">{REASON_LABELS[reason]}</Badge>
                                  </li>
                                ))}
                              </ul>
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
                  total={list.total}
                  params={{ filter: filter === "active" ? undefined : filter }}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
