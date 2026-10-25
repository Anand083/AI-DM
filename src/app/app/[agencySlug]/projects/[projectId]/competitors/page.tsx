import type { Metadata } from "next";
import { CompetitorInsightsPanels } from "@/components/app/competitor-insights-panels";
import { CompetitorPanel } from "@/components/app/competitor-panel";
import { GapTable } from "@/components/app/gap-table";
import { RefreshGapButton } from "@/components/app/refresh-gap-button";
import { StatCard } from "@/components/app/rank-widgets";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { MAX_COMPETITORS } from "@/lib/competitors";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getCompetitorInsights } from "@/server/services/competitor-insights";
import { getComparison, listGap } from "@/server/services/competitors";

export const metadata: Metadata = { title: "Competitors" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function CompetitorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const page = pageFromParams(sp.page);
  const gapPage = pageFromParams(sp.gap_page);
  const [comparison, gap, insights] = await Promise.all([
    getComparison(ctx, projectId, { page, pageSize: PAGE_SIZE }),
    listGap(ctx, projectId, { page: gapPage, pageSize: PAGE_SIZE }),
    getCompetitorInsights(ctx, projectId),
  ]);
  const base = `/app/${agencySlug}/projects/${projectId}/competitors`;
  const canEdit = can(ctx.role, "content.edit");
  const canRun = can(ctx.role, "tools.run");
  const { competitors, summary, rows } = comparison;
  const today = new Date().toISOString().slice(0, 10);
  const refreshedToday =
    competitors.length > 0 &&
    competitors.every((c) => c.gapFetchedAt?.toISOString().slice(0, 10) === today);
  const lastRefresh = competitors
    .map((c) => c.gapFetchedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="space-y-8">
      <section aria-labelledby="who-heading" className="space-y-3">
        <div>
          <h2 id="who-heading" className="text-lg font-semibold">
            Competitors
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Compare this website with up to {MAX_COMPETITORS} others. The comparison uses the top 10
            results saved by your daily rank checks, so it costs nothing extra.
          </p>
        </div>
        <CompetitorPanel
          agencySlug={agencySlug}
          projectId={projectId}
          competitors={competitors.map((c) => ({ id: c.id, domain: c.domain }))}
          max={MAX_COMPETITORS}
          canEdit={canEdit}
        />
      </section>

      <CompetitorInsightsPanels
        insights={insights}
        agencySlug={agencySlug}
        projectId={projectId}
        canEdit={canEdit}
        canRun={canRun}
        hasCompetitors={competitors.length > 0}
      />

      {competitors.length === 0 ? null : (
        <>
          <section aria-labelledby="compare-heading" className="space-y-4">
            <h2 id="compare-heading" className="text-lg font-semibold">
              Ranking comparison
            </h2>
            {comparison.compared === 0 ? (
              <EmptyState
                title="Nothing to compare yet"
                description="Add keywords to the rank tracker and run a check. The top 10 results of each search are saved with it."
              />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {summary.map((s) => (
                    <StatCard
                      key={s.domain}
                      label={s.domain}
                      value={`${s.inTop10} of ${comparison.compared}`}
                      hint={`In the top 10. Ahead of you on ${s.theyAreAhead}, behind you on ${s.youAreAhead}.${s.averagePosition === null ? "" : ` Average position ${s.averagePosition}.`}`}
                    />
                  ))}
                </div>
                <div
                  role="region"
                  aria-label="Ranking comparison table"
                  tabIndex={0}
                  className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <table className="w-full text-left text-sm" aria-label="Ranking comparison">
                    <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">
                          Keyword
                        </th>
                        <th scope="col" className="px-4 py-2 font-medium">
                          You
                        </th>
                        {competitors.map((c) => (
                          <th key={c.id} scope="col" className="px-4 py-2 font-medium">
                            {c.domain}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.phrase}
                          className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                        >
                          <td className="px-4 py-2 font-medium">{r.phrase}</td>
                          <td className="px-4 py-2 tabular-nums">
                            {r.you === null ? "Not in top 100" : r.you}
                          </td>
                          {competitors.map((c) => {
                            const p = r.competitors[c.domain] ?? null;
                            return (
                              <td key={c.id} className="px-4 py-2 tabular-nums">
                                {p === null ? (
                                  <span className="text-zinc-500">Not in top 10</span>
                                ) : (
                                  p
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  basePath={base}
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={comparison.total}
                  params={{ gap_page: gapPage > 1 ? String(gapPage) : undefined }}
                  label="Comparison pages"
                />
              </>
            )}
          </section>

          <section aria-labelledby="gap-heading" className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="gap-heading" className="text-lg font-semibold">
                  Keyword gap
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Keywords your competitors rank for that you do not rank for or track yet.
                  {lastRefresh
                    ? ` Last updated ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(lastRefresh)}.`
                    : ""}
                </p>
              </div>
              {canRun ? (
                <RefreshGapButton
                  agencySlug={agencySlug}
                  projectId={projectId}
                  label={lastRefresh ? "Refresh keyword gap" : "Find keyword gaps"}
                  refreshedToday={refreshedToday}
                />
              ) : null}
            </div>
            {gap.rows.length === 0 ? (
              <EmptyState
                title="No keyword gap yet"
                description="Find keyword gaps to see what your competitors rank for."
              />
            ) : (
              <>
                <GapTable
                  agencySlug={agencySlug}
                  projectId={projectId}
                  canEdit={canEdit}
                  rows={gap.rows.map((r) => ({
                    id: r.id,
                    keyword: r.keyword,
                    position: r.position,
                    volume: r.volume,
                    competitor: r.competitor.domain,
                    url: r.url,
                  }))}
                />
                <Pagination
                  basePath={base}
                  page={gapPage}
                  pageSize={PAGE_SIZE}
                  total={gap.total}
                  pageParam="gap_page"
                  params={{ page: page > 1 ? String(page) : undefined }}
                  label="Keyword gap pages"
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
