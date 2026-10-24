import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Only allow paths inside the app, so a link cannot send people to another site. */
function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const notice = params.reset ? "Your password was changed. You can sign in now." : undefined;
  return (
    <AuthShell
      title="Sign in"
      description="Welcome back."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={safeNext(params.next)} notice={notice} />
    </AuthShell>
  );
}
