import type { Metadata } from "next";
import { ReportBuilder } from "@/components/app/report-builder";
import { EmptyState } from "@/components/ui/empty-state";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { listProjects } from "@/server/services/projects";
import { listReportTemplates } from "@/server/services/report-templates";

export const metadata: Metadata = { title: "New report" };
export const dynamic = "force-dynamic";

export default async function NewReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "reports.create");
  const { rows } = await listProjects(ctx, { pageSize: 100 });
  const templates = await listReportTemplates(ctx);
  const projectId = typeof sp.projectId === "string" ? sp.projectId : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New report</h1>
      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Add a project to a client first. Reports are made for a project."
        />
      ) : (
        <ReportBuilder
          agencySlug={agencySlug}
          defaultProjectId={projectId}
          templates={templates}
          projects={rows.map((p) => ({ id: p.id, name: p.name, clientName: p.client.name }))}
        />
      )}
    </div>
  );
}
