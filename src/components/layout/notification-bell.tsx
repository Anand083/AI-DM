"use client";

import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Placeholder until alerts exist (Step 13). */
export function NotificationBell() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Notifications"
        className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-300 dark:border-zinc-700"
      >
        <Bell className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>You have no notifications yet.</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
