import { z } from "zod";
import { slugProblem } from "@/lib/slug";

/** Form-side checks. The server repeats them in `createAgencySchema`. */
export const createAgencyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(80, "Use 80 characters or fewer."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((value, ctx) => {
      const problem = slugProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  timezone: z.string().min(1, "Choose a time zone."),
});

export type CreateAgencyFormValues = z.infer<typeof createAgencyFormSchema>;

/** Settings page: name, time zone and alert settings. The server repeats these checks. */
export const settingsFormSchema = createAgencyFormSchema
  .pick({ name: true, timezone: true })
  .extend({
    alertDropPositions: z.coerce
      .number()
      .int()
      .min(1, "Use at least 1.")
      .max(50, "Use 50 or less."),
    alertDropWithin: z.coerce.number().int().min(1, "Use at least 1.").max(100, "Use 100 or less."),
    alertTopPosition: z.coerce
      .number()
      .int()
      .min(1, "Use at least 1.")
      .max(100, "Use 100 or less."),
    alertOnCriticalAudit: z.boolean(),
    dailyDigest: z.boolean(),
  });

export type SettingsFormValues = z.input<typeof settingsFormSchema>;
