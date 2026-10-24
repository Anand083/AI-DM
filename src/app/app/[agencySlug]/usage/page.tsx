import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { getPageContext, requirePermission } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Usage" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "branding.edit");
  return (
    <ComingSoon title="Usage" description="See how much of your plan you have used this month." />
  );
}
