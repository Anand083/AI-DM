import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptInvitationButton } from "@/components/app/accept-invitation-button";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSessionUser } from "@/server/auth/session";
import { previewInvitation } from "@/server/services/team";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };
export const dynamic = "force-dynamic";

const ROLE_TEXT = { ADMIN: "an admin", MEMBER: "a team member", CLIENT: "a client" } as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInvitation(token);

  if (preview.status === "invalid") {
    return (
      <AuthShell
        title="This invitation is not valid"
        description="Please ask for a new invitation."
      >
        {null}
      </AuthShell>
    );
  }
  // Client invitations use the agency's own branded pages, never ours.
  if (preview.role === "CLIENT") redirect(`/portal/${preview.agencySlug}/invite/${token}`);

  if (preview.status === "expired") {
    return (
      <AuthShell
        title="This invitation has expired"
        description="Please ask the team to send it again."
      >
        {null}
      </AuthShell>
    );
  }
  if (preview.status === "used") {
    return (
      <AuthShell title="This invitation was already used">
        <Link href="/app" className="text-sm underline">
          Go to the app
        </Link>
      </AuthShell>
    );
  }

  const user = await getSessionUser();
  const here = `/invite/${token}`;
  const title = `Join ${preview.agencyName}`;
  const description = `You were invited as ${ROLE_TEXT[preview.role!]}.`;

  if (!user) {
    const query = `next=${encodeURIComponent(here)}&email=${encodeURIComponent(preview.email!)}`;
    return (
      <AuthShell
        title={title}
        description={`${description} Sign in or create an account with ${preview.email} to accept.`}
      >
        <div className="flex flex-col gap-3">
          <Link
            href={`/signup?${query}`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Create an account
          </Link>
          <Link
            href={`/login?${query}`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            I already have an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (user.email.toLowerCase() !== preview.email!.toLowerCase()) {
    return (
      <AuthShell
        title={title}
        description={`This invitation was sent to ${preview.email}, but you are signed in as ${user.email}.`}
      >
        <SignOutButton />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={title} description={description}>
      <AcceptInvitationButton token={token} />
    </AuthShell>
  );
}
