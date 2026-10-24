import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { safeNext } from "@/lib/safe-next";
import { ResendVerification } from "@/components/auth/resend-verification";

export const metadata: Metadata = { title: "Check your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const email = Array.isArray(params.email) ? params.email[0] : params.email;
  const failed = Boolean(params.error);

  return (
    <AuthShell
      title={failed ? "That link did not work" : "Check your email"}
      description={
        failed
          ? "The link may have expired. Ask for a new one below."
          : email
            ? `We sent a link to ${email}. Open it to finish creating your account.`
            : "We sent you a link. Open it to finish creating your account."
      }
      footer={
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      }
    >
      {email ? <ResendVerification email={email} next={safeNext(params.next)} /> : null}
    </AuthShell>
  );
}
