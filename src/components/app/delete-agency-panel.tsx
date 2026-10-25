"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAgencyAction } from "@/app/app/[agencySlug]/settings/actions";
import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormMessage } from "@/components/auth/field";

export function DeleteAgencyPanel({
  agencySlug,
  agencyName,
}: {
  agencySlug: string;
  agencyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await deleteAgencyAction(agencySlug, { confirmName: name });
    setBusy(false);
    if (!result.ok) return setError(result.fieldErrors?.confirmName ?? result.error);
    router.push("/app");
    router.refresh();
  }

  return (
    <section
      aria-labelledby="delete-h"
      className="space-y-3 rounded-lg border border-red-300 p-4 dark:border-red-900"
    >
      <h2 id="delete-h" className="text-lg font-semibold text-red-800 dark:text-red-300">
        Delete this agency
      </h2>
      <p className="text-sm">
        Your team and clients lose access straight away and shared links stop working. Your data is
        removed for good after 30 days. Download your data first if you want a copy.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="inline-flex h-10 items-center rounded-md border border-red-600 px-4 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-950">
          Delete agency
        </DialogTrigger>
        <DialogContent title="Delete this agency?" description={`Type "${agencyName}" to confirm.`}>
          <form onSubmit={remove} className="space-y-3" noValidate>
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            <Field
              id="confirm-name"
              label="Agency name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <DialogClose className="inline-flex h-10 items-center rounded-md border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700">
                Cancel
              </DialogClose>
              <Button
                type="submit"
                disabled={busy || name.trim().length === 0}
                className="bg-red-700 hover:bg-red-800 dark:bg-red-600 dark:text-white"
              >
                {busy ? "Deleting..." : "Delete agency"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
