import type { Metadata } from "next";
import { getPageContext } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// Placeholder. The real dashboard comes in Step 13.
export default async function AgencyHome({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
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
