import "server-only";
import { formatRate, microsToBaseCents, parseRate, toBaseCents, type RateMap } from "@/lib/money";
import {
  computeProfit,
  daysInUtcMonth,
  totalProfit,
  type ClientProfit,
  type ProfitTotals,
} from "@/lib/profitability";
import { financeSettingsSchema, parseAmountCents, retainerSchema } from "@/lib/schemas/finance";
import { calendarMonth } from "@/lib/usage-period";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError, NotFoundError } from "./errors";
import { paging, type Page } from "./paging";
import { parseInput } from "./validation";

function requireFinance(ctx: TenantContext): void {
  if (!can(ctx.role, "billing.manage")) throw new ForbiddenError();
}

export async function getFinanceSettings(ctx: TenantContext) {
  requireFinance(ctx);
  const [agency, rates] = await Promise.all([
    db.agency.findFirst({
      where: { id: ctx.agencyId },
      select: { baseCurrency: true, hourlyCostCents: true },
    }),
    db.currencyRate.findMany({
      where: { agencyId: ctx.agencyId },
      select: { currency: true, ratePerUnitMicros: true },
      orderBy: { currency: "asc" },
      take: 50,
    }),
  ]);
  if (!agency) throw new NotFoundError("Agency not found.");
  return {
    baseCurrency: agency.baseCurrency,
    hourlyCostCents: agency.hourlyCostCents,
    rates: Object.fromEntries(rates.map((r) => [r.currency, formatRate(r.ratePerUnitMicros)])),
  };
}

export async function saveFinanceSettings(ctx: TenantContext, rawInput: unknown) {
  requireFinance(ctx);
  const input = parseInput(financeSettingsSchema, rawInput);
  const hourly = parseAmountCents(input.hourlyCost);
  const wanted = Object.entries(input.rates)
    .filter(([code, text]) => text !== "" && code !== input.baseCurrency)
    .map(([code, text]) => [code, parseRate(text)!] as const);
  await db.$transaction(async (tx) => {
    await tx.agency.update({
      where: { id: ctx.agencyId },
      data: {
        baseCurrency: input.baseCurrency,
        hourlyCostCents: typeof hourly === "number" ? hourly : 0,
      },
    });
    await tx.currencyRate.deleteMany({
      where: { agencyId: ctx.agencyId, currency: { notIn: wanted.map(([c]) => c) } },
    });
    for (const [currency, ratePerUnitMicros] of wanted) {
      await tx.currencyRate.upsert({
        where: { agencyId_currency: { agencyId: ctx.agencyId, currency } },
        create: { agencyId: ctx.agencyId, currency, ratePerUnitMicros },
        update: { ratePerUnitMicros },
      });
    }
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "finance.settings_saved",
    targetType: "Agency",
    targetId: ctx.agencyId,
  });
}

export async function setClientRetainer(ctx: TenantContext, clientId: string, rawInput: unknown) {
  requireFinance(ctx);
  const input = parseInput(retainerSchema, rawInput);
  const cents = parseAmountCents(input.amount);
  const client = await db.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError("Client not found.");
  await db.client.update({
    where: { id: clientId, agencyId: ctx.agencyId },
    data: {
      retainerCents: typeof cents === "number" ? cents : null,
      retainerCurrency: input.currency,
    },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "client.retainer_set",
    targetType: "Client",
    targetId: clientId,
  });
}

export type ProfitReport = {
  baseCurrency: string;
  month: string;
  day: number;
  daysInMonth: number;
  rows: (ClientProfit & { retainerCents: number | null; retainerCurrency: string })[];
  totals: ProfitTotals;
  total: number;
  missingRates: string[];
};

/**
 * Estimated profit per client for the current UTC month. Revenue is the retainer, provider cost
 * is what the data providers charged for the client's projects, and time cost is finished task
 * estimates times the hourly cost. These are estimates, not accounting.
 */
export async function getProfitReport(
  ctx: TenantContext,
  page: Page = {},
  now: Date = new Date(),
): Promise<ProfitReport> {
  requireFinance(ctx);
  const settings = await getFinanceSettings(ctx);
  const rates: RateMap = Object.fromEntries(
    Object.entries(settings.rates).map(([c, t]) => [c, parseRate(t)!]),
  );
  const { start } = calendarMonth(now);
  const { take, skip } = paging({ pageSize: 50, ...page });
  const where = { agencyId: ctx.agencyId, deletedAt: null, status: "ACTIVE" as const };
  const [clients, total] = await Promise.all([
    db.client.findMany({
      where,
      select: {
        id: true,
        name: true,
        retainerCents: true,
        retainerCurrency: true,
        projects: { where: { deletedAt: null }, select: { id: true }, take: 500 },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.client.count({ where }),
  ]);
  const projectIds = clients.flatMap((c) => c.projects.map((p) => p.id));
  const [spend, work] = projectIds.length
    ? await Promise.all([
        db.usageRecord.groupBy({
          by: ["projectId"],
          where: {
            agencyId: ctx.agencyId,
            projectId: { in: projectIds },
            createdAt: { gte: start },
          },
          _sum: { costMicros: true },
        }),
        db.task.groupBy({
          by: ["projectId"],
          where: {
            agencyId: ctx.agencyId,
            projectId: { in: projectIds },
            status: "DONE",
            completedAt: { gte: start },
          },
          _sum: { estimateMinutes: true },
        }),
      ])
    : [[], []];
  const spendBy = new Map(spend.map((s) => [s.projectId, s._sum.costMicros ?? 0]));
  const minutesBy = new Map(work.map((w) => [w.projectId, w._sum.estimateMinutes ?? 0]));
  const missing = new Set<string>();
  const day = now.getUTCDate();
  const daysInMonth = daysInUtcMonth(now);
  const rows = clients.map((c) => {
    const micros = c.projects.reduce((n, p) => n + (spendBy.get(p.id) ?? 0), 0);
    const minutes = c.projects.reduce((n, p) => n + (minutesBy.get(p.id) ?? 0), 0);
    const revenue =
      c.retainerCents === null
        ? null
        : toBaseCents(c.retainerCents, c.retainerCurrency, settings.baseCurrency, rates);
    if (c.retainerCents !== null && revenue === null) missing.add(c.retainerCurrency);
    const provider = microsToBaseCents(micros, settings.baseCurrency, rates);
    if (provider === null) missing.add("USD");
    const profit = computeProfit(
      {
        clientId: c.id,
        name: c.name,
        revenueCents: revenue,
        providerCents: provider,
        taskMinutes: minutes,
      },
      settings.hourlyCostCents,
      day,
      daysInMonth,
    );
    return { ...profit, retainerCents: c.retainerCents, retainerCurrency: c.retainerCurrency };
  });
  return {
    baseCurrency: settings.baseCurrency,
    month: now.toISOString().slice(0, 7),
    day,
    daysInMonth,
    rows,
    totals: totalProfit(rows),
    total,
    missingRates: [...missing].sort(),
  };
}
