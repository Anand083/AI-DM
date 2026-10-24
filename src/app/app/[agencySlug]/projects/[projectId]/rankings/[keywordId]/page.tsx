import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PositionChart } from "@/components/app/position-chart";
import { ChangeBadge, PositionText, StatCard } from "@/components/app/rank-widgets";
import { getPageContext } from "@/server/auth/page-context";
import { NotFoundError } from "@/server/services/errors";
import { getKeywordDetail } from "@/server/services/keywords";

export const metadata: Metadata = { title: "Keyword" };
export const dynamic = "force-dynamic";

export default async function KeywordPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string; keywordId: string }>;
}) {
  const { agencySlug, projectId, keywordId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const detail = await getKeywordDetail(ctx, projectId, keywordId, 90).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { keyword, history, topResults, project } = detail;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm">
          <Link
            href={`/app/${agencySlug}/projects/${projectId}/rankings`}
            className="underline-offset-4 hover:underline"
          >
            Rankings
          </Link>
        </p>
        <h2 className="mt-1 text-xl font-semibold">{keyword.phrase}</h2>
        {keyword.targetUrl ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Target page: {keyword.targetUrl}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Position</p>
          <p className="mt-1 text-2xl">
            <PositionText
              position={keyword.currentPosition}
              checked={keyword.lastCheckedOn !== null}
            />
          </p>
        </div>
        <StatCard
          label="Best position"
          value={keyword.bestPosition === null ? "-" : String(keyword.bestPosition)}
        />
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Change in 7 days</p>
          <p className="mt-1 text-2xl">
            <ChangeBadge change={keyword.changeWeek} />
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Change in 30 days</p>
          <p className="mt-1 text-2xl">
            <ChangeBadge change={keyword.changeMonth} />
          </p>
        </div>
      </div>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h3 id="history-heading" className="text-lg font-semibold">
          Position over the last 90 days
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This keyword has not been checked yet.
          </p>
        ) : (
          <PositionChart history={history} keyword={keyword.phrase} />
        )}
      </section>

      {topResults.length > 0 ? (
        <section aria-labelledby="top-heading" className="space-y-3">
          <h3 id="top-heading" className="text-lg font-semibold">
            Top 10 results
          </h3>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm" aria-label="Top 10 search results">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Website
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Page title
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {topResults.map((r) => (
                  <tr
                    key={r.position}
                    className={
                      r.domain === project.domain
                        ? "bg-green-50 font-medium dark:bg-green-950"
                        : undefined
                    }
                  >
                    <td className="px-3 py-2 tabular-nums">{r.position}</td>
                    <td className="px-3 py-2">
                      {r.domain}
                      {r.domain === project.domain ? " (you)" : ""}
                    </td>
                    <td className="px-3 py-2">{r.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
