import { z } from "zod";
import { normalizeWebsite } from "@/lib/domain";
import { normalizeHex } from "@/lib/color";

const hexColor = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const hex = normalizeHex(v);
      if (!hex) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} as a hex code, like #2563eb.` });
        return z.NEVER;
      }
      return hex;
    });

export const brandingSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(80, "Use 80 characters or fewer."),
  primaryColor: hexColor("the main color"),
  accentColor: hexColor("the accent color"),
  supportEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || z.email().safeParse(v).success,
      "Enter a valid email address.",
    ),
  website: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || normalizeWebsite(v) !== null,
      "Enter a valid website, like example.com.",
    )
    .transform((v) => (v === undefined ? undefined : normalizeWebsite(v)!)),
});

export type BrandingInput = z.output<typeof brandingSchema>;
export type BrandingFormValues = z.input<typeof brandingSchema>;
