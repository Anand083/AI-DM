import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const email = Array.isArray(params.email) ? params.email[0] : params.email;
  return (
    <AuthShell
      title="Create your account"
      description="Start your 14-day free trial."
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm next={next} defaultEmail={email} />
    </AuthShell>
  );
}
