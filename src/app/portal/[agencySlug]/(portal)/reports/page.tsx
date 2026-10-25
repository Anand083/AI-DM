import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getPortalPageContext } from "@/server/auth/portal-context";
import { listPortalReports } from "@/server/services/portal";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function PortalReports({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPortalPageContext(agencySlug);
  const page = pageFromParams((await searchParams).page);
  const { items, total } = await listPortalReports(ctx, { page, pageSize: PAGE_SIZE });
  const base = `/portal/${agencySlug}/reports`;
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(d);

  return (
    <>
      <h1 className="text-2xl font-semibold">Reports</h1>
      {items.length === 0 ? (
        <EmptyState title="No reports yet" description="New reports will appear here." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-left text-sm" aria-label="Reports">
              <thead className="border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  {["Report", "Website", "Period ends", "Download"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`${base}/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.project.name}</td>
                    <td className="px-3 py-2">{date(r.periodEnd)}</td>
                    <td className="px-3 py-2">
                      <a href={`${base}/${r.id}/pdf`} className="underline underline-offset-4">
                        PDF
                        <span className="sr-only"> for {r.title}</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination basePath={base} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}
