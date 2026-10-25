import { PortalShell } from "@/components/app/portal-shell";
import { getPortalPageContext } from "@/server/auth/portal-context";
import { loadPortalBrand } from "@/server/services/portal-brand";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PortalAppLayout({
  params,
  children,
}: {
  params: Promise<{ agencySlug: string }>;
  children: React.ReactNode;
}) {
  const { agencySlug } = await params;
  const { user } = await getPortalPageContext(agencySlug);
  const brand = await loadPortalBrand(agencySlug);
  if (!brand) notFound();
  return (
    <PortalShell
      agencySlug={agencySlug}
      displayName={brand.displayName}
      hasLogo={brand.hasLogo}
      logoVersion={brand.logoVersion}
      userName={user.name}
    >
      {children}
    </PortalShell>
  );
}
