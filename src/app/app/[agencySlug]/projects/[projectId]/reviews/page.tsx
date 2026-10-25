import type { Metadata } from "next";
import Link from "next/link";
import { BusinessPanel } from "@/components/app/business-panel";
import { CheckReviewsButton } from "@/components/app/check-reviews-button";
import { StatCard } from "@/components/app/rank-widgets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { formatTenths } from "@/lib/reviews";
import { FeatureNotice } from "@/components/app/feature-notice";
import { featureUnavailable } from "@/server/services/feature-status";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import {
  getBusiness,
  getReviewOverview,
  listReviews,
  REVIEW_FILTERS,
  type ReviewFilter,
} from "@/server/services/reviews";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const dayText = (d: Date | string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    typeof d === "string" ? new Date(`${d}T00:00:00Z`) : d,
  );
const signedTenths = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "-" : ""}${(Math.abs(n) / 10).toFixed(1)}`;
const stars = (n: number) => `${n} ${n === 1 ? "star" : "stars"}`;

export default async function ReviewsPage({
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
  const filter: ReviewFilter = REVIEW_FILTERS.includes(asked as ReviewFilter)
    ? (asked as ReviewFilter)
    : "all";
  const page = pageFromParams(sp.page);
  const [business, overview, list] = await Promise.all([
    getBusiness(ctx, projectId),
    getReviewOverview(ctx, projectId),
    listReviews(ctx, projectId, filter, { page, pageSize: PAGE_SIZE }),
  ]);
  const base = `/app/${agencySlug}/projects/${projectId}/reviews`;
  const canEdit = can(ctx.role, "content.edit");
  const canRun = can(ctx.role, "tools.run");
  const { latest, change } = overview;
  const lowCount = overview.stars[0] + overview.stars[1];

  const unavailable = featureUnavailable("reviews");
  return (
    <div className="space-y-8">
      {unavailable ? <FeatureNotice message={unavailable} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Local SEO and reviews</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Track the rating and the newest reviews of the business. We check once a day and warn
            you about new reviews, especially 1 and 2 star ones.
            {latest ? ` Last checked ${dayText(latest.takenOn)}.` : ""}
          </p>
        </div>
        {canRun && business ? (
          <CheckReviewsButton
            agencySlug={agencySlug}
            projectId={projectId}
            label={latest ? "Check again" : "Check reviews"}
            checkedToday={overview.checkedToday}
          />
        ) : null}
      </div>

      <section aria-labelledby="business-heading" className="space-y-3">
        <h3 id="business-heading" className="text-base font-semibold">
          Business
        </h3>
        <BusinessPanel
          key={`${business?.name ?? ""}|${business?.city ?? ""}`}
          agencySlug={agencySlug}
          projectId={projectId}
          business={business ? { name: business.name, city: business.city } : null}
          canEdit={canEdit}
        />
      </section>

      {!business ? (
        <EmptyState
          title="No business linked"
          description="Link the business above to start tracking its rating and reviews."
        />
      ) : !latest ? (
        <EmptyState
          title="No review data yet"
          description="Run the first check to see the rating and the latest reviews."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Average rating"
              value={`${formatTenths(latest.ratingTenths)} out of 5`}
              hint={
                change ? `${signedTenths(change.ratingTenths)} since the check before` : undefined
              }
            />
            <StatCard
              label="Total reviews"
              value={latest.reviewCount.toLocaleString("en-US")}
              hint={
                change
                  ? `${change.reviewCount >= 0 ? "+" : ""}${change.reviewCount} since the check before`
                  : undefined
              }
            />
            <StatCard
              label="New in the last check"
              value={String(latest.newReviews)}
              hint={change ? undefined : "Shown after the second check"}
            />
            <StatCard
              label="Low reviews saved"
              value={String(lowCount)}
              hint="1 and 2 stars among the saved reviews"
            />
          </div>

          <section aria-labelledby="stars-heading" className="space-y-2">
            <h3 id="stars-heading" className="text-base font-semibold">
              Saved reviews by stars
            </h3>
            <ul aria-label="Reviews by stars" className="space-y-1.5">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = overview.stars[n - 1]!;
                const share =
                  overview.storedReviews === 0 ? 0 : (count / overview.storedReviews) * 100;
                return (
                  <li key={n} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0">{stars(n)}</span>
                    <span
                      aria-hidden="true"
                      className="h-3 rounded bg-zinc-700 dark:bg-zinc-300"
                      style={{ width: `${count === 0 ? 0 : Math.max(2, share)}%`, maxWidth: "60%" }}
                    />
                    <span className="tabular-nums">{count}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {overview.history.length > 1 ? (
            <section aria-labelledby="trend-heading" className="space-y-2">
              <h3 id="trend-heading" className="text-base font-semibold">
                Rating over time
              </h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm" aria-label="Rating over time">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      {["Checked", "Rating", "Reviews", "New"].map((h) => (
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
                        <td className="px-4 py-2 tabular-nums">{formatTenths(h.ratingTenths)}</td>
                        <td className="px-4 py-2 tabular-nums">
                          {h.reviewCount.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{h.newReviews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="reviews-heading" className="space-y-3">
            <h3 id="reviews-heading" className="text-base font-semibold">
              Latest reviews
            </h3>
            <nav
              aria-label="Filter reviews"
              className="flex gap-4 border-b border-zinc-200 dark:border-zinc-800"
            >
              {REVIEW_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={f === "all" ? base : `${base}?filter=${f}`}
                  aria-current={f === filter ? "page" : undefined}
                  className={
                    f === filter
                      ? "-mb-px border-b-2 border-zinc-900 px-1 py-2 text-sm font-medium dark:border-zinc-100"
                      : "-mb-px border-b-2 border-transparent px-1 py-2 text-sm text-zinc-600 hover:border-zinc-300 dark:text-zinc-400"
                  }
                >
                  {f === "all" ? "All reviews" : "1 and 2 stars"}
                </Link>
              ))}
            </nav>
            {list.rows.length === 0 ? (
              <EmptyState
                title={filter === "low" ? "No low reviews" : "No reviews saved"}
                description={
                  filter === "low"
                    ? "Good news: no 1 or 2 star reviews were found."
                    : "Nothing to show yet."
                }
              />
            ) : (
              <>
                <ul aria-label="Reviews" className="space-y-3">
                  {list.rows.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.author}</span>
                        <Badge
                          tone={r.rating <= 2 ? "danger" : r.rating === 3 ? "warning" : "success"}
                        >
                          {stars(r.rating)}
                        </Badge>
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {dayText(r.publishedAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm">{r.text}</p>
                      {r.suggestedReply ? (
                        <details className="mt-3 text-sm">
                          <summary className="cursor-pointer font-medium">Suggested reply</summary>
                          <p className="mt-2 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                            {r.suggestedReply}
                          </p>
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                            Read it and change it before you post it.
                          </p>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Pagination
                  basePath={base}
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={list.total}
                  params={{ filter: filter === "all" ? undefined : filter }}
                  label="Review pages"
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
