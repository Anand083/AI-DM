import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign in" };

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
