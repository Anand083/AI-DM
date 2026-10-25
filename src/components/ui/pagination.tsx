import Link from "next/link";

/**
 * Previous / Next links for server-paged lists. Keeps the other query parameters
 * (search, filters) and only changes `page`.
 */
export function Pagination({
  basePath,
  page,
  pageSize,
  total,
  params = {},
  pageParam = "page",
  label = "Pages",
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  params?: Record<string, string | undefined>;
  /** Name of the query parameter that holds the page number. Use another one for a second list on a page. */
  pageParam?: string;
  /** Accessible name of the navigation. Must differ when a page has two lists. */
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    if (p > 1) query.set(pageParam, String(p));
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const linkClass =
    "inline-flex h-9 items-center rounded-md border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  const disabledClass =
    "inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm text-zinc-500 dark:border-zinc-800";

  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
      <span>
        Page {page} of {pages} · {total} {total === 1 ? "result" : "results"}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkClass}>
            Previous
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            Previous
          </span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={linkClass}>
            Next
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

/** Reads `?page=` from search params. Always at least 1. */
export function pageFromParams(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 1;
}
