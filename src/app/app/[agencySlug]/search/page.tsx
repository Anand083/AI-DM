import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getPageContext } from "@/server/auth/page-context";
import { globalSearch, type SearchHit } from "@/server/services/search";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const text = typeof sp.q === "string" ? sp.q : undefined;
  const results = await globalSearch(ctx, text);
  const base = `/app/${agencySlug}`;
  const groups: [string, SearchHit[]][] = [
    ["Clients", results.clients],
    ["Projects", results.projects],
    ["Keywords", results.keywords],
    ["Tasks", results.tasks],
  ];
  const found = groups.some(([, hits]) => hits.length > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Search</h1>
      <form action={`${base}/search`} role="search" className="flex gap-2">
        <label htmlFor="search-page-q" className="sr-only">
          Find anything
        </label>
        <input
          id="search-page-q"
          name="q"
          type="search"
          defaultValue={results.query ?? text ?? ""}
          maxLength={80}
          className="h-10 w-full max-w-md rounded-md border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700"
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Search
        </button>
      </form>
      {results.query === null ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Type at least 2 letters to search your clients, projects, keywords and tasks.
        </p>
      ) : !found ? (
        <EmptyState title="Nothing found" description={`No results for "${results.query}".`} />
      ) : (
        groups
          .filter(([, hits]) => hits.length > 0)
          .map(([title, hits]) => (
            <section key={title} aria-label={title} className="space-y-2">
              <h2 className="text-lg font-semibold">{title}</h2>
              <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {hits.map((h) => (
                  <li key={h.id} className="px-4 py-2 text-sm">
                    <Link
                      href={`${base}${h.path}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {h.label}
                    </Link>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{h.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
    </div>
  );
}
