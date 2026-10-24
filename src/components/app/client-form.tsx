"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { createClientAction, updateClientAction } from "@/app/app/[agencySlug]/clients/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@/lib/form";
import { clientSchema, type ClientFormValues } from "@/lib/schemas/client";

export function ClientForm({
  agencySlug,
  clientId,
  initial,
}: {
  agencySlug: string;
  /** Set when editing. */
  clientId?: string;
  initial?: ClientFormValues;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: initial ?? {
      name: "",
      website: "",
      contactName: "",
      contactEmail: "",
      notes: "",
    },
  });

  async function onSubmit(values: ClientFormValues) {
    setError(null);
    const result = clientId
      ? await updateClientAction(agencySlug, clientId, values)
      : await createClientAction(agencySlug, values);
    if (result.ok) {
      router.push(`/app/${agencySlug}/clients/${result.data.id}`);
      router.refresh();
      return;
    }
    setError(result.error);
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      setFieldError(field as keyof ClientFormValues, { message });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field id="name" label="Client name" error={errors.name?.message} {...register("name")} />
      <Field
        id="website"
        label="Website (optional)"
        placeholder="example.com"
        error={errors.website?.message}
        {...register("website")}
      />
      <Field
        id="contactName"
        label="Contact name (optional)"
        error={errors.contactName?.message}
        {...register("contactName")}
      />
      <Field
        id="contactEmail"
        label="Contact email (optional)"
        type="email"
        error={errors.contactEmail?.message}
        {...register("contactEmail")}
      />
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" {...register("notes")} />
        {errors.notes ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errors.notes.message}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : clientId ? "Save changes" : "Add client"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
