"use client";

import {
  CreditCard,
  FileText,
  FolderKanban,
  CircleHelp,
  Search,
  Gauge,
  LayoutDashboard,
  ListChecks,
  MailPlus,
  Palette,
  Settings,
  TrendingUp,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavKey } from "./nav-items";

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  clients: Users,
  projects: FolderKanban,
  research: Search,
  reports: FileText,
  performance: TrendingUp,
  leads: MailPlus,
  tasks: ListChecks,
  team: UsersRound,
  branding: Palette,
  billing: CreditCard,
  usage: Gauge,
  help: CircleHelp,
  settings: Settings,
};

export type SidebarItem = { key: NavKey; label: string; href: string };

export function SidebarNav({
  items,
  onNavigate,
}: {
  items: SidebarItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = ICONS[item.key];
          const home = item.key === "dashboard";
          const active = home
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  active && "bg-zinc-100 dark:bg-zinc-800",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
