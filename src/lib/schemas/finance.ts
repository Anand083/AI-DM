import { z } from "zod";
import { CURRENCIES, isCurrency, parseRate } from "@/lib/money";

/** "1500" or "1500.50" into cents. Blank gives null. */
export function parseAmountCents(text: string): number | null | "bad" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return "bad";
  return Math.round(Number(t) * 100);
}

const currency = z.string().refine(isCurrency, `Choose one of: ${CURRENCIES.join(", ")}.`);

export const financeSettingsSchema = z
  .object({
    baseCurrency: currency,
    /** Cost of one hour of team time, like 35 or 42.50. */
    hourlyCost: z.string().trim().max(14),
    /** Rates as text per currency: how many units of the base currency 1 unit is worth. */
    rates: z.record(z.string(), z.string().trim().max(14)).default({}),
  })
  .superRefine((v, ctx) => {
    const hourly = parseAmountCents(v.hourlyCost);
    if (hourly === "bad")
      ctx.addIssue({
        code: "custom",
        path: ["hourlyCost"],
        message: "Enter an amount like 35 or 42.50.",
      });
    for (const [code, text] of Object.entries(v.rates)) {
      if (!isCurrency(code)) {
        ctx.addIssue({ code: "custom", path: ["rates", code], message: "Unknown currency." });
      } else if (text !== "" && parseRate(text) === null) {
        ctx.addIssue({
          code: "custom",
          path: ["rates", code],
          message: "Enter a rate like 1.08.",
        });
      }
    }
  });
export type FinanceSettingsInput = z.input<typeof financeSettingsSchema>;

export const retainerSchema = z
  .object({ amount: z.string().trim().max(14), currency })
  .superRefine((v, ctx) => {
    if (parseAmountCents(v.amount) === "bad")
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter an amount like 1500 or 1500.50.",
      });
  });
export type RetainerInput = z.input<typeof retainerSchema>;
