import { z } from "zod";
import { REPORT_SECTION_KEYS } from "../report-model";

export const MAX_RECIPIENTS = 10;

/** Turns "a@x.com, b@y.com" or one address per line into a clean list. */
export function parseRecipients(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const email = z.string().email("Enter valid email addresses.").max(254);

export const reportScheduleSchema = z.object({
  projectId: z.string().min(1),
  frequency: z.enum(["WEEKLY", "MONTHLY"]),
  dayOfWeek: z.number().int().min(1).max(7).default(1),
  dayOfMonth: z
    .number()
    .int()
    .min(1, "Choose a day from 1 to 28.")
    .max(28, "Choose a day from 1 to 28.")
    .default(1),
  hour: z.number().int().min(0).max(23).default(8),
  recipients: z
    .array(email)
    .min(1, "Add at least one email address.")
    .max(MAX_RECIPIENTS, `You can add up to ${MAX_RECIPIENTS} email addresses.`),
  sections: z
    .array(z.enum(REPORT_SECTION_KEYS as [string, ...string[]]))
    .min(1, "Choose at least one section."),
  enabled: z.boolean().default(true),
});
export type ReportScheduleValues = z.input<typeof reportScheduleSchema>;

export const scheduleIdSchema = z.object({ scheduleId: z.string().min(1) });
export const scheduleToggleSchema = z.object({
  scheduleId: z.string().min(1),
  enabled: z.boolean(),
});
