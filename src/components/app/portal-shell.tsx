import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { initials } from "@/lib/brand";

/** Header for portal pages: the agency logo (or initials), its name, and a few links. */
export function PortalShell({
  agencySlug,
  displayName,
  logoVersion,
  hasLogo,
  userName,
  children,
}: {
  agencySlug: string;
  displayName: string;
  hasLogo: boolean;
  logoVersion: string | null;
  userName: string;
  children: React.ReactNode;
}) {
  const base = `/portal/${agencySlug}`;
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header
        className="border-b border-zinc-200 dark:border-zinc-800"
        style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href={base} className="flex items-center gap-3 font-semibold">
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- our own authorized route
              <img
                src={`${base}/logo?v=${logoVersion ?? "1"}`}
                alt=""
                className="size-9 rounded bg-white object-contain p-0.5"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full bg-white text-sm text-zinc-900"
              >
                {initials(displayName)}
              </span>
            )}
            <span>{displayName}</span>
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-4 text-sm">
            <Link href={base} className="underline-offset-4 hover:underline">
              Overview
            </Link>
            <Link href={`${base}/tasks`} className="underline-offset-4 hover:underline">
              Tasks
            </Link>
            <Link href={`${base}/reports`} className="underline-offset-4 hover:underline">
              Reports
            </Link>
            <span className="hidden sm:inline">{userName}</span>
            <SignOutButton redirectTo={`${base}/login`} />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">{children}</main>
    </div>
  );
}
