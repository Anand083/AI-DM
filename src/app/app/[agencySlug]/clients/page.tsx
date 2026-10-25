import type { Metadata } from "next";
import Link from "next/link";
import { SearchForm } from "@/components/ui/search-form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { listClients } from "@/server/services/clients";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const status = sp.status === "ARCHIVED" ? "ARCHIVED" : sp.status === "ALL" ? "ALL" : "ACTIVE";
  const page = pageFromParams(sp.page);
  const { rows, total } = await listClients(ctx, { q, status, page, pageSize: PAGE_SIZE });
  const base = `/app/${agencySlug}/clients`;
  const canEdit = can(ctx.role, "content.edit");
  const addButton = canEdit ? (
    <Link
      href={`${base}/new`}
      className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      Add client
    </Link>
  ) : null;
  const importLink = canEdit ? (
    <Link
      href={`${base}/import`}
      className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      Import from CSV
    </Link>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <div className="flex flex-wrap gap-2">
          {importLink}
          {addButton}
        </div>
      </div>

      <SearchForm label="Search clients" placeholder="Search by name" q={q}>
        <div>
          <label htmlFor="status" className="sr-only">
            Show
          </label>
          <Select id="status" name="status" defaultValue={status} className="w-40">
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
            <option value="ALL">All</option>
          </Select>
        </div>
      </SearchForm>

      {rows.length === 0 ? (
        q || status !== "ACTIVE" ? (
          <EmptyState title="No clients found" description="Try a different search or filter." />
        ) : (
          <EmptyState
            title="No clients yet"
            description="Add your first client to start tracking their websites."
            action={addButton}
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm" aria-label="Clients">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Website
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Projects
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`${base}/${c.id}`} className="underline-offset-4 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{c.website?.replace(/^https:\/\//, "") ?? "-"}</td>
                    <td className="px-4 py-2">{c._count.projects}</td>
                    <td className="px-4 py-2">
                      <Badge tone={c.status === "ACTIVE" ? "success" : "neutral"}>
                        {c.status === "ACTIVE" ? "Active" : "Archived"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            basePath={base}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            params={{ q, status: status === "ACTIVE" ? undefined : status }}
          />
        </>
      )}
    </div>
  );
}
