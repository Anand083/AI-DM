import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/app/project-form";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getClient } from "@/server/services/clients";
import { NotFoundError } from "@/server/services/errors";

export const metadata: Metadata = { title: "Add project" };
export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ agencySlug: string; clientId: string }>;
}) {
  const { agencySlug, clientId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "content.edit");
  const client = await getClient(ctx, clientId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add project for {client.name}</h1>
      <ProjectForm agencySlug={agencySlug} clientId={client.id} />
    </div>
  );
}
