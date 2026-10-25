import { notFound } from "next/navigation";
import { LeadWidget } from "@/components/widget/lead-widget";
import { loadPortalBrand } from "@/server/services/portal-brand";

export const dynamic = "force-dynamic";

/** The free website check that agencies show on their own websites, in a frame. */
export default async function WidgetPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const brand = await loadPortalBrand(agencySlug);
  if (!brand) notFound();
  return (
    <LeadWidget
      agencySlug={agencySlug}
      displayName={brand.displayName}
      hasLogo={brand.hasLogo}
      logoVersion={brand.logoVersion}
      contactEmail={brand.supportEmail}
      contactWebsite={brand.website}
    />
  );
}
