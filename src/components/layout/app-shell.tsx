import type { ReactNode } from "react";
import { AgencySwitcher } from "@/components/app/agency-switcher";
import { Badge } from "@/components/ui/badge";
import type { Role } from "@/server/auth/permissions";
import type { UserAgency } from "@/server/auth/tenant-context";
import { MobileNav } from "./mobile-nav";
import { navItemsFor } from "./nav-items";
import { NotificationBell } from "./notification-bell";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

/** Sidebar on large screens, drawer on small ones, with a top bar on every screen. */
export function AppShell({
  agencySlug,
  agencyName,
  agencies,
  role,
  user,
  showDemoBadge,
  children,
}: {
  agencySlug: string;
  agencyName: string;
  agencies: Pick<UserAgency, "id" | "name" | "slug">[];
  role: Role;
  user: { name: string; email: string };
  showDemoBadge: boolean;
  children: ReactNode;
}) {
  const base = `/app/${agencySlug}`;
  const items = navItemsFor(role).map((item) => ({
    key: item.key,
    label: item.label,
    href: `${base}${item.path}`,
  }));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      <aside className="hidden border-r border-zinc-200 p-4 md:block dark:border-zinc-800">
        <p className="mb-4 truncate px-3 text-sm font-semibold">{agencyName}</p>
        <SidebarNav items={items} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <MobileNav items={items} agencyName={agencyName} />
          <AgencySwitcher agencies={agencies} currentSlug={agencySlug} />
          {showDemoBadge ? <Badge tone="warning">Demo data</Badge> : null}
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <UserMenu name={user.name} email={user.email} settingsHref={`${base}/settings`} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
