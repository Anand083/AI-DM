"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  saveBusinessAction,
  unlinkBusinessAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/reviews/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/** The business whose reviews are tracked: link it, change it, or stop tracking. */
export function BusinessPanel({
  agencySlug,
  projectId,
  business,
  canEdit,
}: {
  agencySlug: string;
  projectId: string;
  business: { name: string; city: string | null } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(business?.name ?? "");
  const [city, setCity] = useState(business?.city ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNameError(undefined);
    const result = await saveBusinessAction(agencySlug, projectId, { name, city });
    setBusy(false);
    if (!result.ok) {
      setNameError(result.fieldErrors?.["values.name"] ?? result.fieldErrors?.name);
      setError(result.error);
      return;
    }
    toast("success", business ? "Business saved." : "Business linked.");
    router.refresh();
  }

  if (!canEdit && !business) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">No business is linked yet.</p>;
  }

  return (
    <div className="space-y-3">
      <form onSubmit={save} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" noValidate>
        <Field
          id="business-name"
          label="Business name"
          placeholder="Bright Dental"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          disabled={!canEdit}
          autoComplete="off"
        />
        <Field
          id="business-city"
          label="City (optional)"
          placeholder="Austin"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          disabled={!canEdit}
          autoComplete="off"
        />
        {canEdit ? (
          <Button type="submit" disabled={busy || !name.trim()}>
            {business ? "Save business" : "Link business"}
          </Button>
        ) : null}
      </form>
      {error && !nameError ? <FormMessage kind="error">{error}</FormMessage> : null}
      {canEdit && business ? (
        <ConfirmDialog
          trigger="Stop tracking reviews"
          title="Stop tracking reviews?"
          description="The saved reviews and the rating history of this project will be deleted."
          confirmLabel="Stop tracking"
          onConfirm={async () => {
            const result = await unlinkBusinessAction(agencySlug, projectId);
            if (!result.ok) return result.error;
            setName("");
            setCity("");
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}
