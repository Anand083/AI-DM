import { initials } from "@/lib/brand";

/** A centred card for portal login and invitation pages, with the agency's logo or initials. */
export function PortalCard({
  agencySlug,
  displayName,
  hasLogo,
  logoVersion,
  title,
  description,
  children,
}: {
  agencySlug: string;
  displayName: string;
  hasLogo: boolean;
  logoVersion: string | null;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex items-center justify-center gap-3">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own route
            <img
              src={`/portal/${agencySlug}/logo?v=${logoVersion ?? "1"}`}
              alt=""
              className="size-12 object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full text-base font-semibold"
              style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
            >
              {initials(displayName)}
            </span>
          )}
          <span className="text-lg font-semibold">{displayName}</span>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
