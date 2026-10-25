import type { Metadata } from "next";
import { BrandingForm } from "@/components/app/branding-form";
import { CustomDomainPanel } from "@/components/app/custom-domain-panel";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getBranding } from "@/server/services/branding";
import { getCustomDomain } from "@/server/services/custom-domain";

export const metadata: Metadata = { title: "Branding" };
export const dynamic = "force-dynamic";

export default async function BrandingPage({
  params,
}: {
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "branding.edit");
  const branding = await getBranding(ctx);
  const domain = await getCustomDomain(ctx);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Branding</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Clients see your name, logo and colors in their portal, in reports and in emails. They
          never see ours.
        </p>
      </div>
      <BrandingForm
        agencySlug={agencySlug}
        canEdit={can(ctx.role, "branding.edit")}
        hasLogo={branding.hasLogo}
        logoVersion={branding.logoVersion}
        initial={{
          displayName: branding.displayName,
          primaryColor: branding.primaryColor,
          accentColor: branding.accentColor,
          supportEmail: branding.supportEmail ?? "",
          website: branding.website ?? "",
        }}
      />
      {domain.enabled ? (
        <CustomDomainPanel
          agencySlug={agencySlug}
          domain={domain.domain}
          status={domain.status}
          records={domain.records}
          allowedByPlan={domain.allowedByPlan}
        />
      ) : null}
    </div>
  );
}
