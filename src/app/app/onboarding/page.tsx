import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/app/onboarding-form";
import { requireUser } from "@/server/auth/session";
import { listUserAgencies } from "@/server/auth/tenant-context";

export const metadata: Metadata = { title: "Create your agency" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const agencies = await listUserAgencies(user.id);
  if (agencies.length > 0) redirect(`/app/${agencies[0]!.slug}`);
  return (
    <AuthShell
      footer={<SignOutButton />}
      title="Create your agency"
      description="This is the workspace for your team and your clients. You get a 14-day free trial."
    >
      <OnboardingForm initialTimezone={user.timezone || "UTC"} />
    </AuthShell>
  );
}
