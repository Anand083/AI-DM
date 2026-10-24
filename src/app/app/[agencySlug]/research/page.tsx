import type { Metadata } from "next";
import Link from "next/link";
import { ResearchTable, type ResearchRow } from "@/components/app/research-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pageFromParams, Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { LANGUAGES } from "@/data/languages";
import { LOCATIONS } from "@/data/locations";
import { FormMessage } from "@/components/auth/field";
import { filterIdeas, IDEA_SORTS, INTENT_LABEL, INTENTS, type IdeaSort } from "@/lib/research";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { AppError } from "@/server/services/errors";
import { listProjects } from "@/server/services/projects";
import { listKeywordLists, searchKeywordIdeas } from "@/server/services/research";
import type { KeywordIntent } from "@/server/providers/seo/types";

export const metadata: Metadata = { title: "Keyword research" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | undefined) =>
  v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;

export default async function ResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "tools.run");

  const seed = one(sp.q)?.trim() ?? "";
  const locationCode = num(one(sp.loc)) ?? 2840;
  const languageCode = one(sp.lang) ?? "en";
  const intent = INTENTS.includes(one(sp.intent) as KeywordIntent)
    ? (one(sp.intent) as KeywordIntent)
    : undefined;
  const minVolume = num(one(sp.minVolume));
  const maxDifficulty = num(one(sp.maxDifficulty));
  const sort = (
    IDEA_SORTS.includes(one(sp.sort) as IdeaSort) ? one(sp.sort) : "volume"
  ) as IdeaSort;
  const dir = one(sp.dir) === "asc" ? "asc" : one(sp.dir) === "desc" ? "desc" : undefined;
  const page = pageFromParams(sp.page);

  let error: string | null = null;
  let cached = false;
  let all: ResearchRow[] = [];
  if (seed) {
    try {
      const result = await searchKeywordIdeas(ctx, { seed, locationCode, languageCode });
      cached = result.cached;
      all = result.ideas;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      error = e.fieldErrors ? Object.values(e.fieldErrors)[0]! : e.message;
    }
  }
  const filtered = filterIdeas(
    all.map((i) => ({ ...i })),
    { intent, minVolume, maxDifficulty, sort, dir },
  );
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const [lists, projects] = await Promise.all([
    listKeywordLists(ctx),
    listProjects(ctx, { pageSize: 100 }),
  ]);

  const carry = {
    q: seed || undefined,
    loc: String(locationCode),
    lang: languageCode,
    intent,
    minVolume: minVolume === undefined ? undefined : String(minVolume),
    maxDifficulty: maxDifficulty === undefined ? undefined : String(maxDifficulty),
    sort: sort === "volume" ? undefined : sort,
    dir,
  };
  const base = `/app/${agencySlug}/research`;
  const exportQuery = new URLSearchParams(
    Object.entries(carry).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Keyword research</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Type a topic and find related searches, with how often people search and how hard it is
            to rank.
          </p>
        </div>
        <Link
          href={`${base}/lists`}
          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Saved lists ({lists.length})
        </Link>
      </div>

      <form
        method="get"
        role="search"
        className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="q">Seed keyword</Label>
            <Input
              id="q"
              name="q"
              defaultValue={seed}
              placeholder="for example: dental implants"
              required
              minLength={2}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc">Country</Label>
            <Select id="loc" name="loc" defaultValue={String(locationCode)}>
              {LOCATIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lang">Language</Label>
            <Select id="lang" name="lang" defaultValue={languageCode}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit">Search</Button>
        </div>
        {seed && !error ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Filter and sort results
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="intent">Intent</Label>
                <Select id="intent" name="intent" defaultValue={intent ?? ""}>
                  <option value="">Any</option>
                  {INTENTS.map((i) => (
                    <option key={i} value={i}>
                      {INTENT_LABEL[i]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minVolume">Searches at least</Label>
                <Input
                  id="minVolume"
                  name="minVolume"
                  type="number"
                  min={0}
                  defaultValue={minVolume}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxDifficulty">Difficulty at most</Label>
                <Input
                  id="maxDifficulty"
                  name="maxDifficulty"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={maxDifficulty}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sort">Sort by</Label>
                <Select id="sort" name="sort" defaultValue={sort}>
                  <option value="volume">Searches a month</option>
                  <option value="difficulty">Difficulty</option>
                  <option value="cpc">Cost per click</option>
                  <option value="keyword">Keyword (A to Z)</option>
                </Select>
              </div>
              <Button type="submit" variant="outline">
                Apply
              </Button>
            </div>
          </details>
        ) : null}
      </form>

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {!seed ? (
        <EmptyState
          title="Start with a topic"
          description="Enter a keyword above, for example “dental implants”, to see related searches."
        />
      ) : error ? null : filtered.length === 0 ? (
        <EmptyState
          title="No keywords match"
          description="Try removing some filters."
          action={
            <Link
              className="text-sm underline"
              href={`${base}?q=${encodeURIComponent(seed)}&loc=${locationCode}&lang=${languageCode}`}
            >
              Clear filters
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p aria-live="polite">
              {filtered.length} {filtered.length === 1 ? "idea" : "ideas"} for “{seed}”
              {cached ? " · saved results, this search was free" : ""}
            </p>
            <a
              href={`${base}/export?${exportQuery}`}
              className="underline-offset-4 hover:underline"
            >
              Download CSV
            </a>
          </div>
          <ResearchTable
            agencySlug={agencySlug}
            rows={rows.map((r) => ({
              keyword: r.keyword,
              volume: r.volume,
              cpcMicros: r.cpcMicros,
              difficulty: r.difficulty,
              intent: r.intent,
              trend: r.trend,
            }))}
            locationCode={locationCode}
            languageCode={languageCode}
            lists={lists.map((l) => ({ id: l.id, name: l.name }))}
            projects={projects.rows.map((p) => ({ id: p.id, name: `${p.name} (${p.domain})` }))}
            canEdit={can(ctx.role, "content.edit")}
          />
          <Pagination
            basePath={base}
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            params={carry}
          />
        </>
      )}
    </div>
  );
}
