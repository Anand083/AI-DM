import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";
import { listKeywordLists } from "@/server/services/research";

export const metadata: Metadata = { title: "Saved keyword lists" };
export const dynamic = "force-dynamic";

export default async function ListsPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "tools.run");
  const [lists, agency] = await Promise.all([listKeywordLists(ctx), getAgency(ctx)]);
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: agency.timezone }).format(d);
  const base = `/app/${agencySlug}/research`;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href={base} className="underline-offset-4 hover:underline">
            Keyword research
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Saved lists</h1>
      </div>
      {lists.length === 0 ? (
        <EmptyState
          title="No saved lists yet"
          description="Search for keywords, select the ones you like and save them to a list."
          action={
            <Link href={base} className="text-sm underline">
              Start researching
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm" aria-label="Saved lists">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  List
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Keywords
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {lists.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`${base}/lists/${l.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{l.itemCount}</td>
                  <td className="px-4 py-2">{date(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
