import type { Metadata } from "next";
import Link from "next/link";
import { RefreshMetricsButton } from "@/components/app/refresh-metrics-button";
import { StatCard } from "@/components/app/rank-widgets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { INTENT_LABELS, type SearchIntent } from "@/lib/keyword-insights";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getKeywordInsights } from "@/server/services/keyword-insights";

export const metadata: Metadata = { title: "Keyword insights" };
export const dynamic = "force-dynamic";

const num = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-US"));
const head = "border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";
const rowCls = "border-b border-zinc-100 last:border-0 dark:border-zinc-900";
const box = "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";

function Table({
  label,
  columns,
  children,
}: {
  label: string;
  columns: string[];
  children: React.ReactNode;
}) {
  return (
    <div role="region" aria-label={`${label} table`} tabIndex={0} className={box}>
      <table className="w-full text-left text-sm" aria-label={label}>
        <thead className={head}>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-4 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default async function KeywordInsightsPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const insights = await getKeywordInsights(ctx, projectId);
  const today = new Date().toISOString().slice(0, 10);
  const metricsOn = insights.metricsOn?.toISOString().slice(0, 10) ?? null;
  const bingOn = insights.bingOn?.toISOString().slice(0, 10) ?? null;

  if (insights.total === 0) {
    return (
      <EmptyState
        title="No keywords yet"
        description="Add keywords on the Rankings tab, then come back for clusters, opportunities and more."
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Keyword insights</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Groups, chances and clashes across your tracked keywords. Search volume and Bing
            positions are read on request.
            {metricsOn ? ` Volume updated ${metricsOn}.` : " No volume yet."}
            {bingOn ? ` Bing checked ${bingOn}.` : ""}
          </p>
        </div>
        {can(ctx.role, "tools.run") ? (
          <RefreshMetricsButton
            agencySlug={agencySlug}
            projectId={projectId}
            label={metricsOn ? "Refresh volume and Bing" : "Get volume and Bing positions"}
            doneToday={metricsOn === today}
          />
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Keywords" value={String(insights.total)} />
        <StatCard
          label="With search volume"
          value={String(insights.withVolume)}
          hint={insights.withVolume === 0 ? "Press the button above" : undefined}
        />
        <StatCard
          label="Clusters"
          value={String(insights.clusters.length)}
          hint="Groups about the same thing"
        />
        <StatCard
          label="Page clashes"
          value={String(insights.cannibalization.length)}
          hint="Pages competing with each other"
        />
      </div>

      <section aria-labelledby="intent-heading" className="space-y-2">
        <h3 id="intent-heading" className="text-base font-semibold">
          What searchers want
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A guess from the words of each keyword, not a fact.
        </p>
        <ul aria-label="Search intent" className="flex flex-wrap gap-2">
          {(Object.keys(INTENT_LABELS) as SearchIntent[]).map((k) => (
            <li key={k}>
              <Badge>
                {INTENT_LABELS[k]}: {insights.intents[k]}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="opp-heading" className="space-y-2">
        <h3 id="opp-heading" className="text-base font-semibold">
          Best chances to grow
        </h3>
        {insights.opportunities.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {insights.withVolume === 0
              ? "Get search volume first. A chance is a keyword outside the top 3 with enough searches."
              : "No keyword outside the top 3 has enough searches to show here."}
          </p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              The score (0 to 100) is the extra visits moving to position 3 could bring, lowered for
              hard keywords. It is an estimate.
            </p>
            <Table
              label="Opportunities"
              columns={["Keyword", "Position", "Searches a month", "Difficulty", "Score"]}
            >
              {insights.opportunities.map((o) => (
                <tr key={o.phrase} className={rowCls}>
                  <td className="px-4 py-2">{o.phrase}</td>
                  <td className="px-4 py-2 tabular-nums">{num(o.position)}</td>
                  <td className="px-4 py-2 tabular-nums">{num(o.volume)}</td>
                  <td className="px-4 py-2 tabular-nums">{num(o.difficulty)}</td>
                  <td className="px-4 py-2 tabular-nums font-medium">{o.opportunity}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </section>

      <section aria-labelledby="cluster-heading" className="space-y-2">
        <h3 id="cluster-heading" className="text-base font-semibold">
          Clusters
        </h3>
        <Table
          label="Keyword clusters"
          columns={["Cluster", "Keywords", "Searches a month", "Average position"]}
        >
          {insights.clusters.map((c) => (
            <tr key={c.name} className={rowCls}>
              <td className="px-4 py-2 font-medium">{c.name}</td>
              <td className="px-4 py-2">
                {c.phrases.slice(0, 6).join(", ")}
                {c.phrases.length > 6 ? `, and ${c.phrases.length - 6} more` : ""}
              </td>
              <td className="px-4 py-2 tabular-nums">{c.volume === 0 ? "-" : num(c.volume)}</td>
              <td className="px-4 py-2 tabular-nums">{c.averagePosition ?? "-"}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section aria-labelledby="clash-heading" className="space-y-2">
        <h3 id="clash-heading" className="text-base font-semibold">
          Pages that compete with each other
        </h3>
        {insights.cannibalization.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No clashes found.</p>
        ) : (
          <ul aria-label="Page clashes" className="space-y-2 text-sm">
            {insights.cannibalization.map((f) =>
              f.kind === "flip" ? (
                <li
                  key={`f-${f.phrase}`}
                  className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <p className="font-medium">&quot;{f.phrase}&quot; keeps switching pages</p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Google changed its pick {f.changes} times in 30 days between{" "}
                    {f.urls.join(" and ")}. Pick one page for it and link to that page.
                  </p>
                </li>
              ) : (
                <li
                  key={`c-${f.cluster}`}
                  className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <p className="font-medium">
                    &quot;{f.cluster}&quot; ranks with {f.pages.length} different pages
                  </p>
                  <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                    {f.pages.map((p) => (
                      <li key={p.url} className="break-all">
                        {p.url}: {p.phrases.join(", ")}
                      </li>
                    ))}
                  </ul>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="map-heading" className="space-y-2">
        <h3 id="map-heading" className="text-base font-semibold">
          Keyword to page map
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {insights.pageMap.unmapped}{" "}
          {insights.pageMap.unmapped === 1 ? "keyword has" : "keywords have"} no target page. Set
          one with &quot;Edit selected&quot; on the{" "}
          <Link
            href={`/app/${agencySlug}/projects/${projectId}/rankings`}
            className="underline-offset-4 hover:underline"
          >
            Rankings
          </Link>{" "}
          tab.
        </p>
        {insights.pageMap.pages.length > 0 ? (
          <Table
            label="Keyword to page map"
            columns={["Target page", "Keywords", "Average position", "Ranking with another page"]}
          >
            {insights.pageMap.pages.slice(0, 50).map((p) => (
              <tr key={p.url} className={rowCls}>
                <td className="break-all px-4 py-2">{p.url}</td>
                <td className="px-4 py-2 tabular-nums">{p.keywords}</td>
                <td className="px-4 py-2 tabular-nums">{p.averagePosition ?? "-"}</td>
                <td className="px-4 py-2 tabular-nums">{p.mismatched}</td>
              </tr>
            ))}
          </Table>
        ) : null}
      </section>
    </div>
  );
}
