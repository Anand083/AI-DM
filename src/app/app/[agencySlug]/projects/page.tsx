import type { Metadata } from "next";
import { ProjectsTable } from "@/components/app/projects-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { SearchForm } from "@/components/ui/search-form";
import { getPageContext } from "@/server/auth/page-context";
import { listProjects } from "@/server/services/projects";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function ProjectsPage({
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
  const page = pageFromParams(sp.page);
  const { rows, total } = await listProjects(ctx, { q, page, pageSize: PAGE_SIZE });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <SearchForm label="Search projects" placeholder="Search by name or domain" q={q} />
      {rows.length === 0 ? (
        <EmptyState
          title={q ? "No projects found" : "No projects yet"}
          description={
            q
              ? "Try a different search."
              : "Open a client and add a project to start tracking a website."
          }
        />
      ) : (
        <>
          <ProjectsTable agencySlug={agencySlug} rows={rows} showClient />
          <Pagination
            basePath={`/app/${agencySlug}/projects`}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            params={{ q }}
          />
        </>
      )}
    </div>
  );
}
