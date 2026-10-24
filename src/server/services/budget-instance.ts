import "server-only";
import { getEnv } from "@/env";
import { rawDb } from "@/server/db/client";
import { enqueueEmail } from "@/server/jobs/enqueue";
import { logger } from "@/server/logger";
import { createBudgetService, type BudgetService } from "./budget";

let budget: BudgetService | undefined;

/** The shared budget guard. Alerts go by email to every super admin. */
export function getBudget(): BudgetService {
  budget ??= createBudgetService({
    db: rawDb,
    defaultBudgetUsd: getEnv().MONTHLY_PROVIDER_BUDGET_USD,
    sendAlert: async (status, level) => {
      const admins = await rawDb.user.findMany({
        where: { isSuperAdmin: true },
        select: { email: true },
        take: 50,
      });
      const subject =
        level === "paused"
          ? "Provider budget reached: scheduled jobs are paused"
          : `Provider budget at ${status.percent}%`;
      const text =
        `Provider spending for ${status.month} is $${status.spentUsd} of $${status.budgetUsd} (${status.percent}%).\n` +
        (level === "paused"
          ? "All scheduled jobs and new data requests are paused until the budget is raised or the month ends."
          : "At 100% scheduled jobs and new data requests will pause.");
      logger.warn({ ...status, level }, "provider budget alert");
      for (const admin of admins) {
        await enqueueEmail(
          { to: admin.email, subject, text, html: `<p>${text.replace(/\n/g, "<br>")}</p>` },
          `budget_${status.month}_${level}_${admin.email}`,
        );
      }
    },
  });
  return budget;
}
