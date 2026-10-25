import type { Metadata } from "next";
import Link from "next/link";
import { ImportClientsForm } from "@/components/app/import-clients-form";
import { getPageContext, requirePermission } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Import clients" };
export const dynamic = "force-dynamic";

export default async function ImportClientsPage({
  params,
}: {
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "content.edit");
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import clients</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Load many clients at once from a CSV file. Add a domain to also create a project for the
          client. Clients with the same name are reused, so you can load a file twice safely.
        </p>
      </div>
      <ImportClientsForm agencySlug={agencySlug} />
      <p className="text-sm">
        <Link href={`/app/${agencySlug}/clients`} className="underline">
          Back to clients
        </Link>
      </p>
    </div>
  );
}
