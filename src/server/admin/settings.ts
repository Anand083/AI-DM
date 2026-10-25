import "server-only";
import { z } from "zod";
import { adminDb } from "@/server/db/admin-client";
import { ValidationError } from "@/server/services/errors";
import type { AdminContext } from "./guard";

const BUDGET_KEY = "providerBudgetUsd";
const MAINTENANCE_KEY = "maintenanceMode";
const FLAGS_KEY = "featureFlags";

/** Features that can be switched off for everyone. New ones are added here as they are built. */
export const FEATURE_FLAGS = [
  { key: "backlinks", label: "Backlinks" },
  { key: "competitors", label: "Competitors" },
  { key: "aiVisibility", label: "AI visibility" },
  { key: "reviews", label: "Reviews" },
  { key: "leadWidget", label: "Lead audit widget" },
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number]["key"];

export async function getPlatformSettings(_admin: AdminContext, defaultBudgetUsd: number) {
  const rows = await adminDb.platformSetting.findMany({
    where: { key: { in: [BUDGET_KEY, MAINTENANCE_KEY, FLAGS_KEY] } },
    take: 10,
  });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const budget = get(BUDGET_KEY);
  const flags = (get(FLAGS_KEY) ?? {}) as Record<string, boolean>;
  return {
    budgetUsd: typeof budget === "number" ? budget : defaultBudgetUsd,
    maintenance: get(MAINTENANCE_KEY) === true,
    // Every feature is on unless it was switched off.
    flags: FEATURE_FLAGS.map((f) => ({ ...f, enabled: flags[f.key] !== false })),
  };
}

const set = (key: string, value: unknown) =>
  adminDb.platformSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });

export async function setProviderBudget(_admin: AdminContext, usd: number) {
  const parsed = z.number().min(0).max(1_000_000).safeParse(usd);
  if (!parsed.success) throw new ValidationError("Enter a budget between 0 and 1,000,000 dollars.");
  await set(BUDGET_KEY, parsed.data);
}

export async function setMaintenanceMode(_admin: AdminContext, on: boolean) {
  await set(MAINTENANCE_KEY, on);
}

export async function setFeatureFlag(_admin: AdminContext, key: string, enabled: boolean) {
  if (!FEATURE_FLAGS.some((f) => f.key === key)) throw new ValidationError("Unknown feature.");
  const row = await adminDb.platformSetting.findUnique({ where: { key: FLAGS_KEY } });
  await set(FLAGS_KEY, { ...((row?.value ?? {}) as Record<string, boolean>), [key]: enabled });
}

/** Whether maintenance mode is on. Called on every page of the agency app, so it is one small read. */
export async function isMaintenanceMode(): Promise<boolean> {
  const row = await adminDb.platformSetting.findUnique({ where: { key: MAINTENANCE_KEY } });
  return row?.value === true;
}

export async function isFeatureEnabled(key: FeatureFlag): Promise<boolean> {
  const row = await adminDb.platformSetting.findUnique({ where: { key: FLAGS_KEY } });
  return ((row?.value ?? {}) as Record<string, boolean>)[key] !== false;
}
