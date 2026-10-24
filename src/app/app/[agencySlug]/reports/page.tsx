import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { getPageContext } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  await getPageContext(agencySlug);
  return (
    <ComingSoon
      title="Reports"
      description="Branded PDF reports will be created and shared from here."
    />
  );
}
