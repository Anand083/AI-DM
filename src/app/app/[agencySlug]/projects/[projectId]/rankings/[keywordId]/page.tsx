import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PositionChart } from "@/components/app/position-chart";
import { ChangeBadge, PositionText, StatCard } from "@/components/app/rank-widgets";
import { getPageContext } from "@/server/auth/page-context";
import { NotFoundError } from "@/server/services/errors";
import { getRankingExplanation } from "@/server/services/keyword-insights";
import { getKeywordDetail } from "@/server/services/keywords";
import { INTENT_LABELS, classifyIntent, opportunityScore } from "@/lib/keyword-insights";

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
  const explanation = await getRankingExplanation(ctx, projectId, keywordId);
  const intent = classifyIntent(keyword.phrase, [
    project.name,
    project.client.name,
    project.domain.split(".")[0] ?? "",
  ]);
  const opportunity = opportunityScore({
    position: keyword.currentPosition,
    volume: keyword.volume,
    difficulty: keyword.difficulty,
  });

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

      <section aria-labelledby="facts-heading" className="space-y-3">
        <h3 id="facts-heading" className="text-lg font-semibold">
          Search numbers
        </h3>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["What searchers want", INTENT_LABELS[intent]],
            [
              "Searches a month",
              keyword.volume === null ? "-" : keyword.volume.toLocaleString("en-US"),
            ],
            ["Difficulty", keyword.difficulty === null ? "-" : `${keyword.difficulty} of 100`],
            ["Chance to grow", opportunity === null ? "-" : `${opportunity} of 100`],
            [
              "Bing position",
              keyword.bingCheckedOn === null
                ? "-"
                : keyword.bingPosition === null
                  ? "Not in the top 100"
                  : String(keyword.bingPosition),
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <dt className="text-sm text-zinc-600 dark:text-zinc-400">{label}</dt>
              <dd className="mt-1 text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {keyword.trend.length > 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Searches by month over the last year, oldest first: {keyword.trend.join(", ")}.
          </p>
        ) : null}
        {keyword.metricsOn === null ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Volume and Bing position are read from the Keyword insights tab.
          </p>
        ) : null}
      </section>

      {explanation ? (
        <section aria-labelledby="why-heading" className="space-y-3">
          <h3 id="why-heading" className="text-lg font-semibold">
            Why did it move?
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {`From ${explanation.from ?? "outside the top 100"} to ${explanation.to ?? "outside the top 100"} between ${explanation.since} and ${explanation.until}. These are leads to check, not proof.`}
          </p>
          <ul aria-label="Possible reasons" className="space-y-2 text-sm">
            {explanation.reasons.map((r) => (
              <li
                key={r.text}
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="font-medium">
                  {r.text}{" "}
                  <span className="font-normal text-zinc-600 dark:text-zinc-400">
                    ({r.confidence} confidence)
                  </span>
                </p>
                <p className="text-zinc-700 dark:text-zinc-300">{r.evidence}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
