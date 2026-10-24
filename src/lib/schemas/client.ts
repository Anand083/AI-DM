import { z } from "zod";
import { normalizeWebsite } from "@/lib/domain";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const clientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(120, "Use 120 characters or fewer."),
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
  contactName: optionalText(120),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || z.email().safeParse(v).success,
      "Enter a valid email address.",
    ),
  notes: optionalText(2000),
});

export type ClientInput = z.output<typeof clientSchema>;
/** What the form holds before the schema cleans it. */
export type ClientFormValues = z.input<typeof clientSchema>;
