import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectDelete } from "@/components/app/project-delete";
import { ProjectForm } from "@/components/app/project-form";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/services/errors";
import { getProject } from "@/server/services/projects";

export const metadata: Metadata = { title: "Project" };
export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const project = await getProject(ctx, projectId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const canEdit = can(ctx.role, "content.edit");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link
            href={`/app/${agencySlug}/clients/${project.client.id}`}
            className="underline-offset-4 hover:underline"
          >
            {project.client.name}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{project.domain}</p>
      </div>
      {canEdit ? (
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
      ) : null}
      {can(ctx.role, "content.delete") ? (
        <ProjectDelete agencySlug={agencySlug} projectId={project.id} projectName={project.name} />
      ) : null}
    </div>
  );
}
