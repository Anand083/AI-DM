"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { SidebarNav, type SidebarItem } from "./sidebar-nav";

/** The menu button and drawer shown on small screens. */
export function MobileNav({ items, agencyName }: { items: SidebarItem[]; agencyName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Open menu"
        className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-300 md:hidden dark:border-zinc-700"
      >
        <Menu className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent title={agencyName} side="left">
        <SidebarNav items={items} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
