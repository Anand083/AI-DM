import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AgencySwitcher } from "@/components/app/agency-switcher";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/server/auth/session";
import { listUserAgencies, loadTenantContext } from "@/server/auth/tenant-context";

export const dynamic = "force-dynamic";

// Basic frame for now. Step 5 replaces it with the full app shell.
export default async function AgencyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const user = await requireUser();
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) notFound();
  const agencies = await listUserAgencies(user.id);

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <AgencySwitcher agencies={agencies} currentSlug={agencySlug} />
        <nav className="flex gap-4 text-sm" aria-label="Main">
          <Link href={`/app/${agencySlug}`} className="underline-offset-4 hover:underline">
            Dashboard
          </Link>
          <Link href={`/app/${agencySlug}/team`} className="underline-offset-4 hover:underline">
            Team
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden sm:inline">{user.name}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>
    </div>
  );
}
