import type { Metadata } from "next";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Account suspended" };
export const dynamic = "force-dynamic";

export default async function SuspendedPage() {
  await requireUser();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">This account is suspended</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your team can no longer sign in to this account for now. Nothing has been deleted. Please
          contact support to get access again.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
