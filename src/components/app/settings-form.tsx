"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { updateSettingsAction } from "@/app/app/[agencySlug]/settings/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { settingsFormSchema, type SettingsFormValues } from "@/lib/agency-schemas";
import { zodResolver } from "@/lib/form";
type Values = SettingsFormValues;

export function SettingsForm({
  agencySlug,
  canEdit,
  initial,
  address,
}: {
  agencySlug: string;
  canEdit: boolean;
  initial: Values;
  address: string;
}) {
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => {
    const list = Intl.supportedValuesOf("timeZone");
    return list.includes(initial.timezone) ? list : [initial.timezone, ...list];
  }, [initial.timezone]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(settingsFormSchema), defaultValues: initial });

  async function onSubmit(values: Values) {
    setError(null);
    const result = await updateSettingsAction(agencySlug, values);
    if (result.ok) toast("success", "Settings saved.");
    else setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id="name"
        label="Agency name"
        disabled={!canEdit}
        error={errors.name?.message}
        {...register("name")}
      />
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Time zone</Label>
        <Select id="timezone" disabled={!canEdit} {...register("timezone")}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Reports and schedules use this time zone.
        </p>
      </div>
      <fieldset
        className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        disabled={!canEdit}
      >
        <legend className="px-1 text-sm font-semibold">Alerts</legend>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Choose when the notification bell should tell you about rankings and audits.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="alertDropPositions"
            label="Drop of at least (places)"
            type="number"
            min={1}
            max={50}
            error={errors.alertDropPositions?.message}
            {...register("alertDropPositions")}
          />
          <Field
            id="alertDropWithin"
            label="For keywords in the top"
            type="number"
            min={1}
            max={100}
            error={errors.alertDropWithin?.message}
            {...register("alertDropWithin")}
          />
          <Field
            id="alertTopPosition"
            label="Tell me when a keyword reaches the top"
            type="number"
            min={1}
            max={100}
            error={errors.alertTopPosition?.message}
            {...register("alertTopPosition")}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="alertOnCriticalAudit"
            type="checkbox"
            className="size-4"
            {...register("alertOnCriticalAudit")}
          />
          <Label htmlFor="alertOnCriticalAudit">
            Tell me about new critical issues found by site audits
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <input id="dailyDigest" type="checkbox" className="size-4" {...register("dailyDigest")} />
          <Label htmlFor="dailyDigest">
            Email owners and admins a summary of new alerts every morning
          </Label>
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="address">Agency address</Label>
        <input
          id="address"
          readOnly
          value={address}
          className="h-10 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      {canEdit ? (
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving..." : "Save changes"}
        </Button>
      ) : null}
    </form>
  );
}
