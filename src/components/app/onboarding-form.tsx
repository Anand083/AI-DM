"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { createAgencyAction } from "@/app/app/onboarding/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { zodResolver } from "@/lib/form";
import { slugify } from "@/lib/slug";
import { createAgencyFormSchema, type CreateAgencyFormValues } from "@/lib/agency-schemas";

export function OnboardingForm({ initialTimezone }: { initialTimezone: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const zones = useMemo(() => {
    const list = Intl.supportedValuesOf("timeZone");
    return list.includes(initialTimezone) ? list : [initialTimezone, ...list];
  }, [initialTimezone]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<CreateAgencyFormValues>({
    resolver: zodResolver(createAgencyFormSchema),
    defaultValues: { name: "", slug: "", timezone: initialTimezone },
  });

  const name = useWatch({ control, name: "name" });
  useEffect(() => {
    if (!slugTouched) setValue("slug", slugify(name ?? ""));
  }, [name, slugTouched, setValue]);

  // The browser knows the real time zone; the server only knows UTC.
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserZone && zones.includes(browserZone)) setValue("timezone", browserZone);
  }, [zones, setValue]);

  async function onSubmit(values: CreateAgencyFormValues) {
    setError(null);
    const result = await createAgencyAction(values);
    if (result.ok) {
      router.push(`/app/${result.data.slug}`);
      router.refresh();
      return;
    }
    setError(result.error);
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      if (field === "name" || field === "slug" || field === "timezone") {
        setFieldError(field, { message });
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id="name"
        label="Agency name"
        autoComplete="organization"
        error={errors.name?.message}
        {...register("name")}
      />
      <Field
        id="slug"
        label="Agency address"
        error={errors.slug?.message}
        {...register("slug", { onChange: () => setSlugTouched(true) })}
      />
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Time zone</Label>
        <select
          id="timezone"
          className="h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          {...register("timezone")}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Reports and schedules use this time zone.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Creating..." : "Create agency"}
      </Button>
    </form>
  );
}
