import type { Metadata } from "next";
import { GooglePanel } from "@/components/app/google-panel";
import { StatCard } from "@/components/app/rank-widgets";
import { FormMessage } from "@/components/auth/field";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPositionTenths, formatTenthsPercent, percentChange } from "@/lib/google-metrics";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getAnalyticsOverview, getGoogleStatus } from "@/server/services/google";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const dayText = (d: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  );
const num = (n: number) => n.toLocaleString("en-US");
const vs = (now: number, before: number) => {
  const change = percentChange(now, before);
  return change === null
    ? undefined
    : `${change >= 0 ? "+" : ""}${change}% against the 28 days before`;
};

const MESSAGES: Record<string, { kind: "error" | "success"; text: string }> = {
  connected: { kind: "success", text: "Google is connected. Choose what to read below." },
  denied: { kind: "error", text: "Google was not connected because access was not allowed." },
  failed: { kind: "error", text: "Google could not be connected. Please try again." },
};

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const [status, overview] = await Promise.all([
    getGoogleStatus(ctx, projectId),
    getAnalyticsOverview(ctx, projectId),
  ]);
  const notice = typeof sp.google === "string" ? MESSAGES[sp.google] : undefined;
  const { connection } = status;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Search Console and Google Analytics</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Real clicks, impressions and visits from Google, next to your rankings. We read them once
          a day.{status.provider === "mock" ? " This copy uses sample Google data." : ""}
        </p>
      </div>
      {notice ? <FormMessage kind={notice.kind}>{notice.text}</FormMessage> : null}

      <section aria-labelledby="connection-heading" className="space-y-3">
        <h3 id="connection-heading" className="text-base font-semibold">
          Connection
        </h3>
        <GooglePanel
          key={`${connection?.gscSite ?? ""}|${connection?.ga4PropertyId ?? ""}|${connection?.status ?? ""}`}
          agencySlug={agencySlug}
          projectId={projectId}
          connection={connection}
          canEdit={can(ctx.role, "content.edit")}
          canRun={can(ctx.role, "tools.run")}
          syncedToday={connection?.lastSyncedOn === today}
        />
      </section>

      {!overview ? (
        connection && (connection.gscSite || connection.ga4PropertyId) ? (
          <EmptyState
            title="No numbers yet"
            description="We are reading your data from Google. This can take a minute."
          />
        ) : null
      ) : (
        <>
          {overview.search?.hasData ? (
            <section aria-labelledby="gsc-heading" className="space-y-3">
              <h3 id="gsc-heading" className="text-base font-semibold">
                Google Search
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                The last 28 days up to {dayText(overview.search.range.end)}.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Clicks"
                  value={num(overview.search.now.clicks)}
                  hint={vs(overview.search.now.clicks, overview.search.before.clicks)}
                />
                <StatCard
                  label="Impressions"
                  value={num(overview.search.now.impressions)}
                  hint={vs(overview.search.now.impressions, overview.search.before.impressions)}
                />
                <StatCard
                  label="Click rate"
                  value={formatTenthsPercent(overview.search.now.ctrTenthsPercent)}
                  hint="Clicks divided by impressions"
                />
                <StatCard
                  label="Average position"
                  value={formatPositionTenths(overview.search.now.positionTenths)}
                  hint="In Google results, lower is better"
                />
              </div>
              <div
                role="region"
                aria-label="Search by day table"
                tabIndex={0}
                className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <table className="w-full text-left text-sm" aria-label="Search by day">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      {["Day", "Clicks", "Impressions", "Average position"].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overview.searchDays.map((d) => (
                      <tr
                        key={d.date}
                        className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                      >
                        <td className="px-4 py-2">{dayText(d.date)}</td>
                        <td className="px-4 py-2 tabular-nums">{num(d.clicks)}</td>
                        <td className="px-4 py-2 tabular-nums">{num(d.impressions)}</td>
                        <td className="px-4 py-2 tabular-nums">
                          {formatPositionTenths(d.positionTenths)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {overview.analytics?.hasData ? (
            <section aria-labelledby="ga-heading" className="space-y-3">
              <h3 id="ga-heading" className="text-base font-semibold">
                Google Analytics
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                The last 28 days up to {dayText(overview.analytics.range.end)}.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard
                  label="Sessions"
                  value={num(overview.analytics.now.sessions)}
                  hint={vs(overview.analytics.now.sessions, overview.analytics.before.sessions)}
                />
                <StatCard
                  label="Conversions"
                  value={num(overview.analytics.now.conversions)}
                  hint={vs(
                    overview.analytics.now.conversions,
                    overview.analytics.before.conversions,
                  )}
                />
              </div>
              <div
                role="region"
                aria-label="Visits by day table"
                tabIndex={0}
                className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <table className="w-full text-left text-sm" aria-label="Visits by day">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      {["Day", "Sessions", "Conversions"].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overview.analyticsDays.map((d) => (
                      <tr
                        key={d.date}
                        className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                      >
                        <td className="px-4 py-2">{dayText(d.date)}</td>
                        <td className="px-4 py-2 tabular-nums">{num(d.sessions)}</td>
                        <td className="px-4 py-2 tabular-nums">{num(d.conversions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
