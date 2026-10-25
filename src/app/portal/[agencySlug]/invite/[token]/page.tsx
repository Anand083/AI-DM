import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalCard } from "@/components/auth/portal-card";
import { PortalInviteForm } from "@/components/app/portal-invite-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSessionUser } from "@/server/auth/session";
import { loadPortalBrand } from "@/server/services/portal-brand";
import { previewPortalInvite } from "@/server/services/portal-invite";

export const metadata: Metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

export default async function PortalInvitePage({
  params,
}: {
  params: Promise<{ agencySlug: string; token: string }>;
}) {
  const { agencySlug, token } = await params;
  const brand = await loadPortalBrand(agencySlug);
  if (!brand) notFound();
  const card = {
    agencySlug,
    displayName: brand.displayName,
    hasLogo: brand.hasLogo,
    logoVersion: brand.logoVersion,
  };
  const preview = await previewPortalInvite(agencySlug, token, brand.displayName);

  if (preview.status !== "valid") {
    const text = {
      invalid: ["This invitation is not valid", "Please ask for a new invitation."],
      expired: ["This invitation has expired", `Please ask ${brand.displayName} to send it again.`],
      used: ["This invitation was already used", "You can sign in to see your reports."],
    }[preview.status];
    return (
      <PortalCard {...card} title={text[0]!} description={text[1]}>
        <Link href={`/portal/${agencySlug}/login`} className="text-sm underline">
          Go to sign in
        </Link>
      </PortalCard>
    );
  }

  const user = await getSessionUser();
  const here = `/portal/${agencySlug}/invite/${token}`;
  const title = `Welcome to ${brand.displayName}`;

  if (!preview.hasAccount) {
    return (
      <PortalCard
        {...card}
        title={title}
        description="Create your access to see your results and reports."
      >
        <PortalInviteForm
          agencySlug={agencySlug}
          token={token}
          email={preview.email}
          needsAccount
        />
      </PortalCard>
    );
  }
  if (!user) {
    return (
      <PortalCard
        {...card}
        title={title}
        description={`You already have an account with ${preview.email}. Sign in to continue.`}
      >
        <Link
          href={`/portal/${agencySlug}/login?next=${encodeURIComponent(here)}`}
          className="inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
          style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
        >
          Sign in
        </Link>
      </PortalCard>
    );
  }
  if (user.email.toLowerCase() !== preview.email.toLowerCase()) {
    return (
      <PortalCard
        {...card}
        title={title}
        description={`This invitation was sent to ${preview.email}, but you are signed in as ${user.email}.`}
      >
        <SignOutButton redirectTo={here} />
      </PortalCard>
    );
  }
  return (
    <PortalCard {...card} title={title} description="Your page is ready.">
      <PortalInviteForm
        agencySlug={agencySlug}
        token={token}
        email={preview.email}
        needsAccount={false}
      />
    </PortalCard>
  );
}
