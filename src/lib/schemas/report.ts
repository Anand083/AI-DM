import { z } from "zod";
import { REPORT_SECTION_KEYS } from "../report-model";

export const reportSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().max(120).optional(),
  period: z.enum(["last7", "last30", "lastMonth", "custom"]),
  start: z.string().optional(),
  end: z.string().optional(),
  sections: z
    .array(z.enum(REPORT_SECTION_KEYS as [string, ...string[]]))
    .min(1, "Choose at least one section.")
    .max(REPORT_SECTION_KEYS.length),
  notes: z.string().trim().max(4000, "Notes can be up to 4000 characters.").optional(),
});
export type ReportInputValues = z.infer<typeof reportSchema>;

export const SHARE_DAY_OPTIONS = [7, 30, 90] as const;
export const shareSchema = z.object({
  reportId: z.string().min(1),
  days: z.number().int().min(1).max(365),
});
