"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProjectTabs({ base, canEdit }: { base: string; canEdit: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Overview", href: base },
    { label: "Rankings", href: `${base}/rankings` },
    { label: "Audit", href: `${base}/audit` },
    { label: "Backlinks", href: `${base}/backlinks` },
    { label: "Competitors", href: `${base}/competitors` },
    { label: "AI visibility", href: `${base}/ai-visibility` },
    ...(canEdit ? [{ label: "Settings", href: `${base}/edit` }] : []),
  ];
  return (
    <nav aria-label="Project" className="border-b border-zinc-200 dark:border-zinc-800">
      <ul className="-mb-px flex gap-4 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium",
                  active
                    ? "border-zinc-900 dark:border-zinc-100"
                    : "border-transparent text-zinc-600 hover:border-zinc-300 dark:text-zinc-400",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
