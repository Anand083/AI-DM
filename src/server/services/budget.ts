import type { PrismaClient } from "@prisma/client";
import { calendarMonth } from "@/lib/usage-period";

export type BudgetState = "ok" | "warn" | "paused";

export const WARN_AT = 0.8;
export const PAUSE_AT = 1;

/** Pure rule: under 80% is fine, 80% to 99% warns, 100% and over pauses. A budget of 0 turns the guard off. */
export function evaluateBudget(
  spentMicros: number,
  budgetMicros: number,
): { state: BudgetState; percent: number } {
  if (budgetMicros <= 0) return { state: "ok", percent: 0 };
  const ratio = spentMicros / budgetMicros;
  const percent = Math.round(ratio * 100);
  if (ratio >= PAUSE_AT) return { state: "paused", percent };
  if (ratio >= WARN_AT) return { state: "warn", percent };
  return { state: "ok", percent };
}

export type BudgetStatus = {
  state: BudgetState;
  percent: number;
  spentUsd: number;
  budgetUsd: number;
  /** "2026-10" */
  month: string;
};

export type BudgetDb = Pick<PrismaClient, "usageRecord" | "platformSetting">;

export type BudgetDeps = {
  db: BudgetDb;
  /** The budget from `MONTHLY_PROVIDER_BUDGET_USD`; a value saved in PlatformSetting wins. */
  defaultBudgetUsd: number;
  /** Called once per month and level when spending reaches 80% or 100%. */
  sendAlert: (status: BudgetStatus, level: "warn" | "paused") => Promise<void>;
  now?: () => Date;
  /** How long a spending total is reused, in milliseconds. */
  cacheMs?: number;
};

const BUDGET_KEY = "providerBudgetUsd";
const ALERTS_KEY = "providerBudgetAlerts";

const toUsd = (micros: number) => Math.round(micros / 10_000) / 100;

/** Platform-wide provider spending guard (plan section 9.5). This is system code across all agencies. */
export function createBudgetService(deps: BudgetDeps) {
  const now = deps.now ?? (() => new Date());
  const cacheMs = deps.cacheMs ?? 30_000;
  let cached: { at: number; status: BudgetStatus } | undefined;

  async function budgetUsd(): Promise<number> {
    const row = await deps.db.platformSetting.findUnique({ where: { key: BUDGET_KEY } });
    const value = row?.value;
    return typeof value === "number" && value >= 0 ? value : deps.defaultBudgetUsd;
  }

  async function status(options: { fresh?: boolean } = {}): Promise<BudgetStatus> {
    if (!options.fresh && cached && Date.now() - cached.at < cacheMs) return cached.status;
    const current = now();
    const month = calendarMonth(current);
    const [sum, budget] = await Promise.all([
      deps.db.usageRecord.aggregate({
        where: { createdAt: { gte: month.start, lt: month.end } },
        _sum: { costMicros: true },
      }),
      budgetUsd(),
    ]);
    const spent = sum._sum.costMicros ?? 0;
    const { state, percent } = evaluateBudget(spent, Math.round(budget * 1_000_000));
    const result: BudgetStatus = {
      state,
      percent,
      spentUsd: toUsd(spent),
      budgetUsd: budget,
      month: month.start.toISOString().slice(0, 7),
    };
    cached = { at: Date.now(), status: result };
    return result;
  }

  /**
   * Looks at the spending and sends the alert for a level once per month.
   * Called from the 15 minute maintenance tick and before provider calls.
   */
  async function checkAndAlert(): Promise<BudgetStatus> {
    const current = await status({ fresh: true });
    if (current.state === "ok") return current;
    const row = await deps.db.platformSetting.findUnique({ where: { key: ALERTS_KEY } });
    const saved = row?.value as { month?: string; sent?: string[] } | null | undefined;
    const sent = saved?.month === current.month ? (saved.sent ?? []) : [];
    const levels: ("warn" | "paused")[] =
      current.state === "paused" ? ["warn", "paused"] : ["warn"];
    for (const level of levels) {
      if (sent.includes(level)) continue;
      sent.push(level);
      // Save first so a crash cannot make us send the same alert over and over.
      await deps.db.platformSetting.upsert({
        where: { key: ALERTS_KEY },
        create: { key: ALERTS_KEY, value: { month: current.month, sent } },
        update: { value: { month: current.month, sent } },
      });
      await deps.sendAlert(current, level);
    }
    return current;
  }

  async function isPaused(): Promise<boolean> {
    return (await status()).state === "paused";
  }

  return { status, checkAndAlert, isPaused, clearCache: () => void (cached = undefined) };
}

export type BudgetService = ReturnType<typeof createBudgetService>;
