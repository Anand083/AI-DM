"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { updateBrandingAction } from "@/app/app/[agencySlug]/branding/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { brandCssVars, initials } from "@/lib/brand";
import { checkBrandColors, normalizeHex } from "@/lib/color";
import { zodResolver } from "@/lib/form";
import { brandingSchema, type BrandingFormValues } from "@/lib/schemas/branding";

type Props = {
  agencySlug: string;
  canEdit: boolean;
  initial: Required<Pick<BrandingFormValues, "displayName" | "primaryColor" | "accentColor">> & {
    supportEmail: string;
    website: string;
  };
  hasLogo: boolean;
  logoVersion: string | null;
};

const MAX_BYTES = 1024 * 1024;

function ColorField({
  id,
  label,
  value,
  onPick,
  error,
  disabled,
  register,
}: {
  id: string;
  label: string;
  value: string;
  onPick: (hex: string) => void;
  error?: string;
  disabled: boolean;
  register: ReturnType<ReturnType<typeof useForm<BrandingFormValues>>["register"]>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}, color picker`}
          value={normalizeHex(value) ?? "#000000"}
          onChange={(e) => onPick(e.target.value)}
          disabled={disabled}
          className="size-10 shrink-0 cursor-pointer rounded-md border border-zinc-300 bg-transparent p-1 dark:border-zinc-700"
        />
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 font-mono text-sm dark:border-zinc-700"
          {...register}
        />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function BrandingForm({ agencySlug, canEdit, initial, hasLogo, logoVersion }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<{ file: File; preview: string } | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError: setFieldError,
    formState: { errors },
  } = useForm<BrandingFormValues>({
    resolver: zodResolver(brandingSchema),
    defaultValues: initial,
  });

  const values = useWatch({ control });
  const name = values.displayName?.trim() || initial.displayName;
  const primary = normalizeHex(values.primaryColor ?? "") ?? initial.primaryColor;
  const accent = normalizeHex(values.accentColor ?? "") ?? initial.accentColor;
  const warnings = checkBrandColors({
    primaryColor: values.primaryColor ?? "",
    accentColor: values.accentColor ?? "",
  });
  const savedLogoUrl = hasLogo ? `/app/${agencySlug}/branding/logo?v=${logoVersion ?? "1"}` : null;
  const logoUrl = pickedFile ? pickedFile.preview : removeLogo ? null : savedLogoUrl;

  function pickFile(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLogoError(
        file.type === "image/svg+xml"
          ? "SVG images are not allowed. Use a PNG, JPG or WebP image."
          : "Use a PNG, JPG or WebP image.",
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      setLogoError("The logo must be 1 MB or smaller.");
      return;
    }
    if (pickedFile) URL.revokeObjectURL(pickedFile.preview);
    setPickedFile({ file, preview: URL.createObjectURL(file) });
    setRemoveLogo(false);
  }

  async function sendLogo(): Promise<string | null> {
    if (pickedFile) {
      const form = new FormData();
      form.set("logo", pickedFile.file);
      const response = await fetch(`/app/${agencySlug}/branding/logo`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          fieldErrors?: { logo?: string };
          error?: string;
        };
        return body.fieldErrors?.logo ?? body.error ?? "The logo could not be uploaded.";
      }
    } else if (removeLogo && hasLogo) {
      const response = await fetch(`/app/${agencySlug}/branding/logo`, { method: "DELETE" });
      if (!response.ok) return "The logo could not be removed.";
    }
    return null;
  }

  async function onSubmit(formValues: BrandingFormValues) {
    setBusy(true);
    setError(null);
    const logoProblem = await sendLogo();
    if (logoProblem) {
      setBusy(false);
      setLogoError(logoProblem);
      return;
    }
    const result = await updateBrandingAction(agencySlug, formValues);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        setFieldError(field as keyof BrandingFormValues, { message });
      }
      return;
    }
    toast("success", "Branding saved.");
    setPickedFile(null);
    setRemoveLogo(false);
    router.refresh();
  }

  const vars = brandCssVars({ primaryColor: primary, accentColor: accent });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Field
          id="displayName"
          label="Name your clients see"
          disabled={!canEdit}
          error={errors.displayName?.message}
          {...register("displayName")}
        />

        <div className="space-y-1.5">
          <Label htmlFor="logo">Logo</Label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              id="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!canEdit}
              onChange={(e) => pickFile(e.target.files?.[0])}
              className="text-sm"
            />
            {canEdit && (logoUrl || hasLogo) && !removeLogo ? (
              <Button
                type="button"
                variant="ghost"
                className="h-9"
                onClick={() => {
                  setPickedFile(null);
                  setRemoveLogo(true);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                Remove logo
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            PNG, JPG or WebP, up to 1 MB. It is resized to fit 512 by 512 pixels.
          </p>
          {logoError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {logoError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField
            id="primaryColor"
            label="Main color"
            value={values.primaryColor ?? ""}
            onPick={(hex) => setValue("primaryColor", hex, { shouldValidate: true })}
            error={errors.primaryColor?.message}
            disabled={!canEdit}
            register={register("primaryColor")}
          />
          <ColorField
            id="accentColor"
            label="Accent color"
            value={values.accentColor ?? ""}
            onPick={(hex) => setValue("accentColor", hex, { shouldValidate: true })}
            error={errors.accentColor?.message}
            disabled={!canEdit}
            register={register("accentColor")}
          />
        </div>
        {warnings.length > 0 ? (
          <ul
            role="status"
            className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            {warnings.map((w) => (
              <li key={w.field}>{w.message}</li>
            ))}
          </ul>
        ) : null}

        <Field
          id="supportEmail"
          label="Support email (optional)"
          type="email"
          disabled={!canEdit}
          error={errors.supportEmail?.message}
          {...register("supportEmail")}
        />
        <Field
          id="website"
          label="Website (optional)"
          placeholder="youragency.com"
          disabled={!canEdit}
          error={errors.website?.message}
          {...register("website")}
        />

        {canEdit ? (
          <Button type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save branding"}
          </Button>
        ) : null}
      </form>

      <aside aria-label="Preview" className="space-y-2">
        <h2 className="text-sm font-semibold">Preview</h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          This is how your clients will see you in their portal, reports and emails.
        </p>
        <Card
          className="overflow-hidden p-0"
          style={vars as React.CSSProperties}
          data-testid="brand-preview"
        >
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`${name} logo`}
                className="size-9 rounded bg-white object-contain p-0.5"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: "var(--brand-primary-text)", color: "var(--brand-primary)" }}
              >
                {initials(name)}
              </span>
            )}
            <span className="font-semibold" data-testid="preview-name">
              {name}
            </span>
          </div>
          <div className="space-y-3 px-4 py-4 text-sm">
            <p>Your SEO report is ready.</p>
            <p>
              <a
                href="#preview"
                onClick={(e) => e.preventDefault()}
                className="font-medium underline"
                style={{ color: "var(--brand-accent)" }}
              >
                View the full report
              </a>
            </p>
            <span
              className="inline-block rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: "var(--brand-accent)", color: "var(--brand-accent-text)" }}
            >
              Download PDF
            </span>
            {values.supportEmail || values.website ? (
              <p className="text-xs text-zinc-600">
                Questions? {values.supportEmail ?? ""} {values.website ?? ""}
              </p>
            ) : null}
          </div>
        </Card>
      </aside>
    </div>
  );
}
