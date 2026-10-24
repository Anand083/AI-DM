"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { createProjectAction, updateProjectAction } from "@/app/app/[agencySlug]/clients/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LANGUAGES } from "@/data/languages";
import { LOCATIONS } from "@/data/locations";
import { zodResolver } from "@/lib/form";
import { projectSchema, type ProjectFormValues } from "@/lib/schemas/project";

export function ProjectForm({
  agencySlug,
  clientId,
  projectId,
  initial,
}: {
  agencySlug: string;
  /** Needed when creating. */
  clientId?: string;
  /** Set when editing. */
  projectId?: string;
  initial?: ProjectFormValues;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: initial ?? {
      name: "",
      domain: "",
      locationCode: 2840,
      languageCode: "en",
      device: "DESKTOP",
      rankCheckFrequency: "DAILY",
      autoAudit: false,
    },
  });

  async function onSubmit(values: ProjectFormValues) {
    setError(null);
    const result = projectId
      ? await updateProjectAction(agencySlug, projectId, values)
      : await createProjectAction(agencySlug, clientId!, values);
    if (result.ok) {
      router.push(
        clientId
          ? `/app/${agencySlug}/clients/${clientId}`
          : `/app/${agencySlug}/projects/${projectId}`,
      );
      router.refresh();
      return;
    }
    setError(result.error);
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      const name = field.replace(/^values\./, "");
      setFieldError(name as keyof ProjectFormValues, { message });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field id="name" label="Project name" error={errors.name?.message} {...register("name")} />
      <Field
        id="domain"
        label="Website domain"
        placeholder="example.com"
        error={errors.domain?.message}
        {...register("domain")}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="locationCode">Country</Label>
          <Select id="locationCode" {...register("locationCode")}>
            {LOCATIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="languageCode">Language</Label>
          <Select id="languageCode" {...register("languageCode")}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="device">Device</Label>
          <Select id="device" {...register("device")}>
            <option value="DESKTOP">Desktop</option>
            <option value="MOBILE">Mobile</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rankCheckFrequency">Check rankings</Label>
          <Select id="rankCheckFrequency" {...register("rankCheckFrequency")}>
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Every week</option>
          </Select>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <input id="autoAudit" type="checkbox" className="size-4" {...register("autoAudit")} />
          <Label htmlFor="autoAudit">Run a site audit automatically every month</Label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : projectId ? "Save changes" : "Add project"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
