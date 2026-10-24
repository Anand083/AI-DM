import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

// Placeholder. Step 4 replaces this with onboarding and the agency redirect.
export default async function AppHome() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">You are signed in.</p>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
