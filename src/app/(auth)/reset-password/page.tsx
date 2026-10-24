import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token || params.error) {
    return (
      <AuthShell
        title="This link is not valid"
        description="It may have expired or already been used."
      >
        <Link href="/forgot-password" className="text-sm underline">
          Ask for a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
