import type { Metadata } from "next";
import { ProjectDelete } from "@/components/app/project-delete";
import { ProjectForm } from "@/components/app/project-form";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getProject } from "@/server/services/projects";

export const metadata: Metadata = { title: "Project settings" };
export const dynamic = "force-dynamic";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "content.edit");
  const project = await getProject(ctx, projectId);
  return (
    <div className="space-y-6">
      <ProjectForm
        agencySlug={agencySlug}
        projectId={project.id}
        initial={{
          name: project.name,
          domain: project.domain,
          locationCode: project.locationCode,
          languageCode: project.languageCode,
          device: project.device,
          rankCheckFrequency: project.rankCheckFrequency,
        }}
      />
      {can(ctx.role, "content.delete") ? (
        <ProjectDelete agencySlug={agencySlug} projectId={project.id} projectName={project.name} />
      ) : null}
    </div>
  );
}
