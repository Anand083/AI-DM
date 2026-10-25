import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getPortalPageContext } from "@/server/auth/portal-context";
import { listPortalProjects } from "@/server/services/portal";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

export default async function PortalHome({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPortalPageContext(agencySlug);
  const page = pageFromParams((await searchParams).page);
  const { items, total } = await listPortalProjects(ctx, { page, pageSize: PAGE_SIZE });
  const base = `/portal/${agencySlug}`;

  return (
    <>
      <h1 className="text-2xl font-semibold">Your websites</h1>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description="Your websites will appear here as soon as they are set up."
        />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2" aria-label="Websites">
            {items.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`${base}/projects/${p.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {p.name}
                  </Link>
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{p.domain}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-zinc-600 dark:text-zinc-400">Average position</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {p.averagePosition ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600 dark:text-zinc-400">On page one</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {p.top10} of {p.keywords}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600 dark:text-zinc-400">Site health</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {p.auditScore === null ? "-" : `${p.auditScore}/100`}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <Pagination basePath={base} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}
