import { z } from "zod";

/** A calendar day like 2026-03-31. Impossible days (31 February, month 13) are refused. */
export const dateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date like 2026-03-31.")
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, "Enter a real date.");
