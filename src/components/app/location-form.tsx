"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createLocationAction,
  deleteLocationAction,
  updateLocationAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/locations/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type Values = { name: string; city: string; address: string; phone: string };
const EMPTY: Values = { name: "", city: "", address: "", phone: "" };

/** Add a location, or change one (the name, address and phone are what listings are compared with). */
export function LocationForm({
  agencySlug,
  projectId,
  location,
  canDelete,
}: {
  agencySlug: string;
  projectId: string;
  location?: Values & { id: string };
  canDelete?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<Values>(
    location
      ? {
          name: location.name,
          city: location.city,
          address: location.address,
          phone: location.phone,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const idp = location ? `loc-${location.id}` : "loc-new";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const result = location
      ? await updateLocationAction(agencySlug, projectId, location.id, values)
      : await createLocationAction(agencySlug, projectId, values);
    setBusy(false);
    if (!result.ok) {
      const next: Record<string, string> = {};
      for (const [k, m] of Object.entries(result.fieldErrors ?? {}))
        next[k.replace(/^values\./, "")] = m;
      setFields(next);
      return setError(result.error);
    }
    toast("success", location ? "Location saved." : "Location added.");
    if (!location) setValues(EMPTY);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field
        id={`${idp}-name`}
        label="Name of the place"
        value={values.name}
        onChange={set("name")}
        error={fields.name}
        autoComplete="off"
      />
      <Field
        id={`${idp}-city`}
        label="City"
        value={values.city}
        onChange={set("city")}
        error={fields.city}
        autoComplete="off"
      />
      <Field
        id={`${idp}-address`}
        label="Full address"
        value={values.address}
        onChange={set("address")}
        error={fields.address}
        autoComplete="off"
      />
      <Field
        id={`${idp}-phone`}
        label="Phone number"
        value={values.phone}
        onChange={set("phone")}
        error={fields.phone}
        autoComplete="off"
      />
      {error && Object.keys(fields).length === 0 ? (
        <div className="sm:col-span-2">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {location ? "Save location" : "Add location"}
        </Button>
        {location && canDelete ? (
          <ConfirmDialog
            trigger="Delete location"
            title={`Delete ${location.name}?`}
            description="Its local positions and listing results are deleted too."
            confirmLabel="Delete"
            onConfirm={async () => {
              const result = await deleteLocationAction(agencySlug, projectId, location.id);
              if (!result.ok) return result.error;
              router.refresh();
              return null;
            }}
          />
        ) : null}
      </div>
    </form>
  );
}
