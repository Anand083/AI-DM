import type { Metadata } from "next";
import Link from "next/link";
import { AddKeywordsForm } from "@/components/app/add-keywords-form";
import { CheckNowButton } from "@/components/app/check-now-button";
import { RankingsTable, type RankingRow } from "@/components/app/rankings-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { SearchForm } from "@/components/ui/search-form";
import { Select } from "@/components/ui/select";
import { BUCKETS, type BucketKey } from "@/lib/rank-math";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { listProjectTags, listRankings, SORTS, type RankingSort } from "@/server/services/keywords";

export const metadata: Metadata = { title: "Rankings" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RankingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);

  const q = one(sp.q) || undefined;
  const tag = one(sp.tag) || undefined;
  const bucketParam = one(sp.bucket);
  const bucket = (
    BUCKETS.some((b) => b.key === bucketParam) || bucketParam === "unchecked"
      ? bucketParam
      : undefined
  ) as BucketKey | "unchecked" | undefined;
  const sort = (
    SORTS.includes(one(sp.sort) as RankingSort) ? one(sp.sort) : "keyword"
  ) as RankingSort;
  const dir = one(sp.dir) === "desc" ? "desc" : "asc";
  const page = pageFromParams(sp.page);

  const [{ rows, total }, tags] = await Promise.all([
    listRankings(ctx, projectId, { q, tag, bucket, sort, dir, page, pageSize: PAGE_SIZE }),
    listProjectTags(ctx, projectId),
  ]);

  const base = `/app/${agencySlug}/projects/${projectId}/rankings`;
  const canEdit = can(ctx.role, "content.edit");
  const canRun = can(ctx.role, "tools.run");
  const hasFilter = Boolean(q || tag || bucket);

  const query = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (tag) p.set("tag", tag);
    if (bucket) p.set("bucket", bucket);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p.toString();
  };
  const sortHref = (column: RankingSort) => {
    // Position and keyword start low to high. Change starts with the biggest gains.
    const defaultDir = column === "change" ? "desc" : "asc";
    const nextDir = sort === column ? (dir === "asc" ? "desc" : "asc") : defaultDir;
    return `${base}?${query({ sort: column, dir: nextDir })}`;
  };

  const tableRows: RankingRow[] = rows.map((r) => ({
    id: r.id,
    phrase: r.phrase,
    tags: r.tags,
    checked: r.lastCheckedOn !== null,
    position: r.currentPosition,
    url: r.currentUrl,
    features: r.currentFeatures,
    best: r.bestPosition,
    changeDay: r.changeDay,
    changeWeek: r.changeWeek,
    changeMonth: r.changeMonth,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">Keyword rankings</h2>
        <div className="flex flex-wrap items-start gap-3">
          {canRun && total > 0 ? (
            <CheckNowButton agencySlug={agencySlug} projectId={projectId} label="Check all now" />
          ) : null}
          <a
            href={`${base}/export?${query({ sort, dir })}`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Download CSV
          </a>
        </div>
      </div>

      {canEdit ? (
        <details className="group">
          <summary className="inline-flex h-10 cursor-pointer items-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Add keywords
          </summary>
          <Card className="mt-3">
            <AddKeywordsForm agencySlug={agencySlug} projectId={projectId} />
          </Card>
        </details>
      ) : null}

      <SearchForm
        label="Search keywords"
        placeholder="Search keywords"
        q={q}
        hidden={{ sort, dir }}
      >
        <div>
          <label htmlFor="tag" className="sr-only">
            Tag
          </label>
          <Select id="tag" name="tag" defaultValue={tag ?? ""} className="w-40">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="bucket" className="sr-only">
            Position
          </label>
          <Select id="bucket" name="bucket" defaultValue={bucket ?? ""} className="w-44">
            <option value="">All positions</option>
            {BUCKETS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.key === "none" ? b.label : `Position ${b.label}`}
              </option>
            ))}
            <option value="unchecked">Not checked yet</option>
          </Select>
        </div>
      </SearchForm>

      {total === 0 ? (
        hasFilter ? (
          <EmptyState
            title="No keywords match"
            description="Try a different search or filter."
            action={
              <Link href={base} className="text-sm underline">
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No keywords yet"
            description={
              canEdit
                ? "Use “Add keywords” to paste a list, one keyword per line."
                : "No keywords are tracked for this project yet."
            }
          />
        )
      ) : (
        <>
          <RankingsTable
            agencySlug={agencySlug}
            projectId={projectId}
            rows={tableRows}
            sort={sort}
            dir={dir}
            canEdit={canEdit}
            canRun={canRun}
            sortHrefs={{
              keyword: sortHref("keyword"),
              position: sortHref("position"),
              change: sortHref("change"),
              best: sortHref("best"),
            }}
          />
          <Pagination
            basePath={base}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            params={{
              q,
              tag,
              bucket,
              sort: sort === "keyword" && dir === "asc" ? undefined : sort,
              dir: dir === "asc" && sort === "keyword" ? undefined : dir,
            }}
          />
        </>
      )}
    </div>
  );
}
