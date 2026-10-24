import { requireUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { notFound } from "next/navigation";
import { getAgency } from "@/server/services/agency";

export const dynamic = "force-dynamic";

// Placeholder. The dashboard comes in Step 13.
export default async function AgencyHome({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const user = await requireUser();
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) notFound();
  const agency = await getAgency(ctx);
  return (
    <>
      <h1 className="text-2xl font-semibold">{agency.name}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Your dashboard will show up here.
      </p>
    </>
  );
}
