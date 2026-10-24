import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientForm } from "@/components/app/client-form";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getClient } from "@/server/services/clients";
import { NotFoundError } from "@/server/services/errors";

export const metadata: Metadata = { title: "Edit client" };
export const dynamic = "force-dynamic";

export default async function EditClientPage({
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
      <h1 className="text-2xl font-semibold">Edit {client.name}</h1>
      <ClientForm
        agencySlug={agencySlug}
        clientId={client.id}
        initial={{
          name: client.name,
          website: client.website ?? "",
          contactName: client.contactName ?? "",
          contactEmail: client.contactEmail ?? "",
          notes: client.notes ?? "",
        }}
      />
    </div>
  );
}
