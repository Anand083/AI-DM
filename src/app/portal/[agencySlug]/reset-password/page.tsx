import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalCard } from "@/components/auth/portal-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { loadPortalBrand } from "@/server/services/portal-brand";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function PortalResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const query = await searchParams;
  const brand = await loadPortalBrand(agencySlug);
  if (!brand) notFound();
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  const card = {
    agencySlug,
    displayName: brand.displayName,
    hasLogo: brand.hasLogo,
    logoVersion: brand.logoVersion,
  };
  if (!token || query.error) {
    return (
      <PortalCard
        {...card}
        title="This link is not valid"
        description="It may have expired or already been used."
      >
        <Link href={`/portal/${agencySlug}/forgot-password`} className="text-sm underline">
          Ask for a new link
        </Link>
      </PortalCard>
    );
  }
  return (
    <PortalCard {...card} title="Choose a new password">
      <ResetPasswordForm token={token} loginHref={`/portal/${agencySlug}/login?reset=1`} />
    </PortalCard>
  );
}
