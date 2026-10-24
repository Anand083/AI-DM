import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListItemsTable } from "@/components/app/list-items-table";
import { EmptyState } from "@/components/ui/empty-state";
import { pageFromParams, Pagination } from "@/components/ui/pagination";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/services/errors";
import { listProjects } from "@/server/services/projects";
import { getKeywordList, listKeywordListItems } from "@/server/services/research";

export const metadata: Metadata = { title: "Keyword list" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, listId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "tools.run");
  const orNotFound = (e: unknown): never => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  };
  const list = await getKeywordList(ctx, listId).catch(orNotFound);
  const page = pageFromParams(sp.page);
  const [{ rows, total }, projects] = await Promise.all([
    listKeywordListItems(ctx, listId, { page, pageSize: PAGE_SIZE }),
    listProjects(ctx, { pageSize: 100 }),
  ]);
  const base = `/app/${agencySlug}/research/lists/${listId}`;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link
            href={`/app/${agencySlug}/research/lists`}
            className="underline-offset-4 hover:underline"
          >
            Saved lists
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{list.name}</h1>
          <a href={`${base}/export`} className="text-sm underline-offset-4 hover:underline">
            Download CSV
          </a>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {total} {total === 1 ? "keyword" : "keywords"}
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="This list is empty"
          description="Save keywords from your research to see them here."
        />
      ) : (
        <>
          <ListItemsTable
            agencySlug={agencySlug}
            listId={listId}
            listName={list.name}
            rows={rows.map((r) => ({
              id: r.id,
              phrase: r.phrase,
              volume: r.volume,
              cpcMicros: r.cpcMicros,
              difficulty: r.difficulty,
              intent: r.intent,
            }))}
            projects={projects.rows.map((p) => ({ id: p.id, name: `${p.name} (${p.domain})` }))}
            canEdit={can(ctx.role, "content.edit")}
            canDelete={can(ctx.role, "content.delete")}
          />
          <Pagination basePath={base} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </div>
  );
}
