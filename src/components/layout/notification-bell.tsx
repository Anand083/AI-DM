"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markAlertReadAction } from "@/app/app/[agencySlug]/alerts/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type BellAlert = {
  id: string;
  title: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  read: boolean;
};

const DOT = { INFO: "bg-blue-500", WARNING: "bg-amber-500", CRITICAL: "bg-red-600" } as const;

/** The bell in the top bar: a count of unread alerts and the latest few. */
export function NotificationBell({
  agencySlug,
  unread,
  recent,
}: {
  agencySlug: string;
  unread: number;
  recent: BellAlert[];
}) {
  const router = useRouter();
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="relative inline-flex size-9 items-center justify-center rounded-md border border-zinc-300 dark:border-zinc-700"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <DropdownMenuLabel>
          {unread > 0 ? `${unread} unread` : "You have no unread notifications."}
        </DropdownMenuLabel>
        {recent.length > 0 ? <DropdownMenuSeparator /> : null}
        {recent.map((alert) => (
          <DropdownMenuItem
            key={alert.id}
            className="items-start gap-2"
            onSelect={async () => {
              if (!alert.read) await markAlertReadAction(agencySlug, alert.id);
              router.push(`/app/${agencySlug}/alerts`);
              router.refresh();
            }}
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2 shrink-0 rounded-full ${alert.read ? "bg-zinc-300 dark:bg-zinc-700" : DOT[alert.severity]}`}
            />
            <span className={alert.read ? "text-zinc-600 dark:text-zinc-400" : "font-medium"}>
              {alert.title}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/app/${agencySlug}/alerts`}>See all alerts</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
