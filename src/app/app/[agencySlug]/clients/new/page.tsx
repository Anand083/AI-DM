import type { Metadata } from "next";
import { ClientForm } from "@/components/app/client-form";
import { getPageContext, requirePermission } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Add client" };
export const dynamic = "force-dynamic";

export default async function NewClientPage({
  params,
}: {
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "content.edit");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add client</h1>
      <ClientForm agencySlug={agencySlug} />
    </div>
  );
}
