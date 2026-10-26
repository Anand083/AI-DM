import type { Metadata } from "next";
import Link from "next/link";
import { CheckNowButton } from "@/components/app/check-now-button";
import { ProgressCard } from "@/components/app/progress-card";
import { ChangeBadge, DistributionBars, StatCard } from "@/components/app/rank-widgets";
import { EmptyState } from "@/components/ui/empty-state";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getAnalyticsOverview } from "@/server/services/google";
import { getProjectSummary } from "@/server/services/keywords";
import { getProjectProgress } from "@/server/services/progress";

export const metadata: Metadata = { title: "Project overview" };
export const dynamic = "force-dynamic";

const linkClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

export default async function ProjectOverview({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const [summary, google, progress] = await Promise.all([
    getProjectSummary(ctx, projectId),
    getAnalyticsOverview(ctx, projectId),
    getProjectProgress(ctx, projectId),
  ]);
  const base = `/app/${agencySlug}/projects/${projectId}`;

  if (summary.totalKeywords === 0) {
    return (
      <EmptyState
        title="No keywords yet"
        description="Add the search phrases you want to track. We check where this website ranks for each one."
        action={
          can(ctx.role, "content.edit") ? (
            <Link href={`${base}/rankings`} className={linkClass}>
              Add keywords
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <ProgressCard progress={progress} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Average position"
          value={summary.averagePosition === null ? "-" : String(summary.averagePosition)}
          hint="Keywords that rank in the top 100"
        />
        <StatCard
          label="Visibility"
          value={`${summary.visibility}%`}
          hint="Share of clicks the keywords can win"
        />
        <StatCard
          label="Keywords ranking"
          value={`${summary.rankingKeywords} of ${summary.totalKeywords}`}
          hint={
            summary.checkedKeywords < summary.totalKeywords
              ? `${summary.totalKeywords - summary.checkedKeywords} not checked yet`
              : undefined
          }
        />
        <StatCard label="Last checked" value={summary.lastCheckedOn ?? "Not yet"} />
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {can(ctx.role, "tools.run") ? (
          <CheckNowButton agencySlug={agencySlug} projectId={projectId} />
        ) : null}
        <Link
          href={`${base}/rankings`}
          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          See all rankings
        </Link>
      </div>

      {google && (google.search?.hasData || google.analytics?.hasData) ? (
        <section aria-labelledby="google-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="google-heading" className="text-lg font-semibold">
              Google numbers, last 28 days
            </h2>
            <Link href={`${base}/analytics`} className="text-sm underline-offset-4 hover:underline">
              See all Google numbers
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {google.search?.hasData ? (
              <>
                <StatCard
                  label="Search clicks"
                  value={google.search.now.clicks.toLocaleString("en-US")}
                />
                <StatCard
                  label="Search impressions"
                  value={google.search.now.impressions.toLocaleString("en-US")}
                />
              </>
            ) : null}
            {google.analytics?.hasData ? (
              <>
                <StatCard
                  label="Sessions"
                  value={google.analytics.now.sessions.toLocaleString("en-US")}
                />
                <StatCard
                  label="Conversions"
                  value={google.analytics.now.conversions.toLocaleString("en-US")}
                />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="dist-heading" className="space-y-3">
        <h2 id="dist-heading" className="text-lg font-semibold">
          Where the keywords rank
        </h2>
        <DistributionBars counts={summary.distribution} total={summary.checkedKeywords} />
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <MoversList
          title="Biggest gains this week"
          rows={summary.topGainers}
          base={`${base}/rankings`}
        />
        <MoversList
          title="Biggest drops this week"
          rows={summary.topLosers}
          base={`${base}/rankings`}
        />
      </div>
    </div>
  );
}

function MoversList({
  title,
  rows,
  base,
}: {
  title: string;
  rows: { id: string; phrase: string; changeWeek: number | null }[];
  base: string;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing to show yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <Link
                href={`${base}/${r.id}`}
                className="truncate underline-offset-4 hover:underline"
              >
                {r.phrase}
              </Link>
              <ChangeBadge change={r.changeWeek} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
