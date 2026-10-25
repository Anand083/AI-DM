import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentTaskButton,
  DeleteUpdateButton,
  LogUpdateForm,
} from "@/components/app/content-tools";
import { StatCard } from "@/components/app/rank-widgets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { FLAG_LABELS, FRESHNESS_LABELS } from "@/lib/content";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import {
  INVENTORY_FILTERS,
  INVENTORY_SORTS,
  getDecayingPages,
  getLinkSuggestions,
  listContentInventory,
  listContentUpdates,
  pathKey,
  type InventoryFilter,
  type InventorySort,
} from "@/server/services/content";

export const metadata: Metadata = { title: "Content" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const head = "border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";
const rowCls = "border-b border-zinc-100 last:border-0 dark:border-zinc-900";
const box = "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const num = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-US"));
const SORT_LABELS: Record<InventorySort, string> = {
  issues: "Most problems",
  words: "Fewest words",
  oldest: "Oldest update",
  links: "Fewest internal links",
  url: "Address",
};
const FILTER_LABELS: Record<InventoryFilter, string> = {
  all: "All pages",
  decaying: "Losing traffic",
  stale: "Out of date",
  thin: "Thin content",
  duplicate: "Duplicate content",
};

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const sort = (
    INVENTORY_SORTS.includes(one(sp.sort) as InventorySort) ? one(sp.sort) : "issues"
  ) as InventorySort;
  const filter = (
    INVENTORY_FILTERS.includes(one(sp.show) as InventoryFilter) ? one(sp.show) : "all"
  ) as InventoryFilter;
  const page = pageFromParams(sp.page);
  const [inventory, decaying, suggestions, updates] = await Promise.all([
    listContentInventory(ctx, projectId, { page, pageSize: PAGE_SIZE, sort, filter }),
    getDecayingPages(ctx, projectId),
    getLinkSuggestions(ctx, projectId),
    listContentUpdates(ctx, projectId),
  ]);
  const base = `/app/${agencySlug}/projects/${projectId}/content`;
  const canEdit = can(ctx.role, "content.edit");
  const query = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sort !== "issues") p.set("sort", sort);
    if (filter !== "all") p.set("show", filter);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const text = p.toString();
    return text ? `${base}?${text}` : base;
  };

  if (!inventory) {
    return (
      <EmptyState
        title="No audit yet"
        description="The content list comes from a site audit. Run one on the Audit tab first."
      />
    );
  }
  const { summary } = inventory;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Content</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The pages from the audit of {inventory.auditOn}, with Google traffic, age and what needs
            attention. Traffic needs Search Console and is read once a day.
          </p>
        </div>
        <a
          href={`${base}/export`}
          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Download CSV
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Pages" value={String(summary.pages)} />
        <StatCard label="Losing traffic" value={String(summary.decaying)} hint="Down 30% or more" />
        <StatCard
          label="Out of date"
          value={String(summary.stale)}
          hint={`${summary.unknownAge} with no update date`}
        />
        <StatCard label="Thin content" value={String(summary.thin)} />
        <StatCard label="Duplicate content" value={String(summary.duplicate)} />
      </div>

      <section aria-labelledby="decay-heading" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="decay-heading" className="text-base font-semibold">
              Pages losing traffic
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Clicks from Google in the last 28 days against the 28 days before. Pages with fewer
              than 30 clicks before are not counted.
            </p>
          </div>
          {canEdit && decaying.length > 0 ? (
            <ContentTaskButton
              agencySlug={agencySlug}
              projectId={projectId}
              urls={decaying.map((d) => d.url)}
              label={`Create tasks for all ${decaying.length}`}
            />
          ) : null}
        </div>
        {decaying.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No page is losing traffic, or Google is not connected yet.
          </p>
        ) : (
          <div role="region" aria-label="Pages losing traffic table" tabIndex={0} className={box}>
            <table className="w-full text-left text-sm" aria-label="Pages losing traffic">
              <thead className={head}>
                <tr>
                  {["Page", "Clicks now", "Clicks before", "Change", "Keywords", ""].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decaying.map((d) => (
                  <tr key={d.url} className={rowCls}>
                    <td className="max-w-xs break-all px-4 py-2">{pathKey(d.url)}</td>
                    <td className="px-4 py-2 tabular-nums">{d.clicks}</td>
                    <td className="px-4 py-2 tabular-nums">{d.clicksBefore}</td>
                    <td className="px-4 py-2 tabular-nums">-{d.percent}%</td>
                    <td className="px-4 py-2">{d.keywords.join(", ") || "-"}</td>
                    <td className="px-4 py-2">
                      {canEdit ? (
                        <ContentTaskButton
                          agencySlug={agencySlug}
                          projectId={projectId}
                          urls={[d.url]}
                          label="Create task"
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="inventory-heading" className="space-y-3">
        <h3 id="inventory-heading" className="text-base font-semibold">
          All pages
        </h3>
        <nav aria-label="Show pages" className="flex flex-wrap gap-3 text-sm">
          {INVENTORY_FILTERS.map((f) => (
            <Link
              key={f}
              href={query({ show: f })}
              aria-current={filter === f ? "page" : undefined}
              className={
                filter === f ? "font-semibold underline" : "underline-offset-4 hover:underline"
              }
            >
              {FILTER_LABELS[f]}
            </Link>
          ))}
        </nav>
        <p className="flex flex-wrap gap-3 text-sm">
          Sort by:{" "}
          {INVENTORY_SORTS.map((o) => (
            <Link
              key={o}
              href={query({ sort: o })}
              aria-current={sort === o ? "true" : undefined}
              className={
                sort === o ? "font-semibold underline" : "underline-offset-4 hover:underline"
              }
            >
              {SORT_LABELS[o]}
            </Link>
          ))}
        </p>
        {inventory.rows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No pages match.</p>
        ) : (
          <div role="region" aria-label="Content inventory table" tabIndex={0} className={box}>
            <table className="w-full text-left text-sm" aria-label="Content inventory">
              <thead className={head}>
                <tr>
                  {[
                    "Page",
                    "Words",
                    "Internal links",
                    "Last updated",
                    "Clicks (28 days)",
                    "Needs attention",
                  ].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inventory.rows.map((r) => (
                  <tr key={r.url} className={rowCls}>
                    <td className="max-w-sm break-all px-4 py-2">
                      <div className="font-medium">{r.title ?? "(no title)"}</div>
                      <div className="text-zinc-600 dark:text-zinc-400">{pathKey(r.url)}</div>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.wordCount}</td>
                    <td className="px-4 py-2 tabular-nums">{num(r.inlinks)}</td>
                    <td className="px-4 py-2">
                      {r.lastModified ?? "-"}
                      <span className="sr-only"> ({FRESHNESS_LABELS[r.freshness]})</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{num(r.clicks)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.flags.length === 0
                          ? "-"
                          : r.flags.map((f) => <Badge key={f}>{FLAG_LABELS[f]}</Badge>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          basePath={base}
          page={page}
          pageSize={PAGE_SIZE}
          total={inventory.total}
          params={{
            sort: sort === "issues" ? undefined : sort,
            show: filter === "all" ? undefined : filter,
          }}
        />
      </section>

      <section aria-labelledby="links-heading" className="space-y-3">
        <h3 id="links-heading" className="text-base font-semibold">
          Internal link ideas
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Pages that could rank higher but have 2 or fewer links from your own site. Add a link from
          the pages listed, using the keyword as the link text.
        </p>
        {suggestions.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No link ideas right now.</p>
        ) : (
          <ul aria-label="Internal link ideas" className="space-y-2 text-sm">
            {suggestions.map((s) => (
              <li
                key={s.target}
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="font-medium break-all">
                  {pathKey(s.target)}{" "}
                  <span className="font-normal text-zinc-600 dark:text-zinc-400">
                    ({s.inlinks} internal {s.inlinks === 1 ? "link" : "links"}, keyword &quot;
                    {s.keyword}&quot;)
                  </span>
                </p>
                <p className="text-zinc-700 dark:text-zinc-300">
                  Link to it from: {s.from.map((f) => pathKey(f.url)).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="updates-heading" className="space-y-3">
        <h3 id="updates-heading" className="text-base font-semibold">
          Did the update help?
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Log a page when you update it. We keep its numbers from just before and compare them with
          the latest 28 days, after 14 days have passed. Google needs time to react.
        </p>
        {canEdit ? <LogUpdateForm agencySlug={agencySlug} projectId={projectId} /> : null}
        {updates.length > 0 ? (
          <ul aria-label="Logged updates" className="space-y-2 text-sm">
            {updates.map((u) => (
              <li key={u.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-all">{pathKey(u.url)}</span>
                  <span className="text-zinc-600 dark:text-zinc-400">updated {u.updatedOn}</span>
                  {u.note ? <span>{u.note}</span> : null}
                  {can(ctx.role, "content.delete") ? (
                    <span className="ml-auto">
                      <DeleteUpdateButton agencySlug={agencySlug} projectId={projectId} id={u.id} />
                    </span>
                  ) : null}
                </div>
                {u.result.ready ? (
                  <p className="mt-1">
                    {u.result.verdict === "better"
                      ? "Better"
                      : u.result.verdict === "worse"
                        ? "Worse"
                        : "About the same"}
                    : clicks {u.baseline.clicks} before,{" "}
                    {u.result.clicksChange === null
                      ? "new traffic"
                      : `${u.result.clicksChange >= 0 ? "+" : ""}${u.result.clicksChange}%`}{" "}
                    since.
                    {u.result.positionChangeTenths !== null
                      ? ` Average position ${u.result.positionChangeTenths > 0 ? "improved" : u.result.positionChangeTenths < 0 ? "dropped" : "stayed"} ${u.result.positionChangeTenths === 0 ? "" : `by ${Math.abs(u.result.positionChangeTenths) / 10}`}.`
                      : ""}
                    {u.result.partial
                      ? " Only part of the 28 days have passed, so this may still change."
                      : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                    Too early to tell. Check back in {u.result.daysLeft}{" "}
                    {u.result.daysLeft === 1 ? "day" : "days"}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
