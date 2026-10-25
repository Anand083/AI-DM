import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { PortalCard } from "@/components/auth/portal-card";
import { safeNext } from "@/lib/safe-next";
import { getSessionUser } from "@/server/auth/session";
import { loadPortalContext } from "@/server/auth/tenant-context";
import { loadPortalBrand } from "@/server/services/portal-brand";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function PortalLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const brand = await loadPortalBrand(agencySlug);
  if (!brand) notFound();
  const home = `/portal/${agencySlug}`;
  const user = await getSessionUser();
  if (user && (await loadPortalContext(user.id, agencySlug))) redirect(home);
  const next = safeNext((await searchParams).next, home);
  return (
    <PortalCard
      agencySlug={agencySlug}
      displayName={brand.displayName}
      hasLogo={brand.hasLogo}
      logoVersion={brand.logoVersion}
      title="Sign in"
      description={`See your reports from ${brand.displayName}.`}
    >
      <LoginForm next={next} forgotHref={null} />
      <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">
        Forgot your password?{" "}
        {brand.supportEmail ? `Write to ${brand.supportEmail}` : `Ask ${brand.displayName}`} and
        they will send you a new invitation.
      </p>
    </PortalCard>
  );
}
