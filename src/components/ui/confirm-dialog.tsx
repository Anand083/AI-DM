"use client";

import { useState, type ReactNode } from "react";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/** A button that asks "are you sure?" before running `onConfirm`. Errors are shown in the dialog. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  triggerClassName,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  /** Return an error message to keep the dialog open, or null when it worked. */
  onConfirm: () => Promise<string | null>;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    const message = await onConfirm();
    setBusy(false);
    if (message) setError(message);
    else setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger
        className={
          triggerClassName ??
          "inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        }
      >
        {trigger}
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <div className="space-y-4">
          {error ? <FormMessage kind="error">{error}</FormMessage> : null}
          <div className="flex justify-end gap-2">
            <DialogClose className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700">
              Cancel
            </DialogClose>
            <Button onClick={confirm} disabled={busy}>
              {busy ? "Please wait..." : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
