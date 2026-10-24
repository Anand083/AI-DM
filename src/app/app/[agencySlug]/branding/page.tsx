import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { getPageContext, requirePermission } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Branding" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "branding.edit");
  return (
    <ComingSoon
      title="Branding"
      description="Add your logo and colors so clients see your brand, not ours."
    />
  );
}
