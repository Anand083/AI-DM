import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Start your 14-day free trial."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
