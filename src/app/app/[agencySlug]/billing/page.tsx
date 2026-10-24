import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { getPageContext, requirePermission } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "billing.manage");
  return (
    <ComingSoon
      title="Billing"
      description="Plan, invoices and payment details will be managed here."
    />
  );
}
