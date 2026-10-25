import type { Metadata } from "next";
import Link from "next/link";
import { ToastProvider } from "@/components/ui/toast";
import { getEnv } from "@/env";
import { requireSuperAdmin } from "@/server/admin/guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin" },
  robots: { index: false, follow: false },
};

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/agencies", label: "Agencies" },
  { href: "/admin/queues", label: "Queues" },
  { href: "/admin/providers", label: "Data provider" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/settings", label: "Settings" },
] as const;

/** Only super admins get past this. Everyone else sees the normal 404 page. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireSuperAdmin();
  return (
    <ToastProvider>
      <div className="min-h-screen">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="font-semibold">{getEnv().APP_NAME} admin</span>
            <nav aria-label="Admin" className="flex flex-wrap gap-4 text-sm">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="underline-offset-4 hover:underline">
                  {l.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">{admin.email}</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
