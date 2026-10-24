import { z } from "zod";
import { LANGUAGE_CODES } from "@/data/languages";
import { LOCATION_CODES } from "@/data/locations";
import { normalizeDomain } from "@/lib/domain";

export const projectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(120, "Use 120 characters or fewer."),
  domain: z
    .string()
    .trim()
    .min(1, "Enter the website domain, like example.com.")
    .transform((v, ctx) => {
      const domain = normalizeDomain(v);
      if (!domain) {
        ctx.addIssue({ code: "custom", message: "Enter a valid domain, like example.com." });
        return z.NEVER;
      }
      return domain;
    }),
  locationCode: z.coerce
    .number()
    .int()
    .refine((v) => LOCATION_CODES.has(v), "Choose a country from the list."),
  languageCode: z.string().refine((v) => LANGUAGE_CODES.has(v), "Choose a language from the list."),
  device: z.enum(["DESKTOP", "MOBILE"]),
  rankCheckFrequency: z.enum(["DAILY", "WEEKLY"]),
});

export type ProjectInput = z.output<typeof projectSchema>;
export type ProjectFormValues = z.input<typeof projectSchema>;
