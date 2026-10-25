import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { PortalCard } from "@/components/auth/portal-card";
import { loadPortalBrand } from "@/server/services/portal-brand";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default async function PortalForgotPasswordPage({
  params,
}: {
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const brand = await loadPortalBrand(agencySlug);
  if (!brand) notFound();
  return (
    <PortalCard
      agencySlug={agencySlug}
      displayName={brand.displayName}
      hasLogo={brand.hasLogo}
      logoVersion={brand.logoVersion}
      title="Forgot your password?"
      description="Enter your email and we will send you a link to choose a new one."
    >
      <ForgotPasswordForm redirectTo={`/portal/${agencySlug}/reset-password`} />
      <p className="mt-4 text-sm">
        <Link href={`/portal/${agencySlug}/login`} className="underline">
          Back to sign in
        </Link>
      </p>
    </PortalCard>
  );
}
