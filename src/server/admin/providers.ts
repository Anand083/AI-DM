import "server-only";
import { getEnv } from "@/env";
import { microsToCents } from "@/lib/admin-metrics";
import { adminDb } from "@/server/db/admin-client";
import {
  parseOverrides,
  resolveProviderName,
  type ProviderName,
} from "@/server/providers/seo/overrides";
import { getProviderByName } from "@/server/providers/seo";
import { SEO_MODULES } from "@/server/providers/seo/types";
import { NotFoundError } from "@/server/services/errors";
import type { AdminContext } from "./guard";

/** What the data provider page shows. Passwords and keys are never included. */
export async function getProviderOverview(_admin: AdminContext, now = new Date()) {
  const env = getEnv();
  const { overrides } = parseOverrides(env.SEO_PROVIDER_OVERRIDES);
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [today, month] = await Promise.all([
    adminDb.usageRecord.groupBy({
      by: ["provider"],
      where: { createdAt: { gte: startOfDay } },
      _sum: { costMicros: true },
    }),
    adminDb.usageRecord.groupBy({
      by: ["provider"],
      where: { createdAt: { gte: startOfMonth } },
      _sum: { costMicros: true },
    }),
  ]);
  const spend = (rows: typeof today, provider: string) =>
    microsToCents(rows.find((r) => r.provider === provider)?._sum.costMicros ?? 0);
  const names: ProviderName[] = ["mock", "dataforseo"];

  return {
    defaultProvider: env.SEO_PROVIDER,
    modules: SEO_MODULES.map((module) => ({
      module,
      provider: resolveProviderName(module, env.SEO_PROVIDER, overrides),
    })),
    environment:
      env.SEO_PROVIDER === "mock" && Object.keys(overrides).length === 0
        ? "mock"
        : env.DATAFORSEO_BASE_URL.includes("sandbox")
          ? "sandbox"
          : "live",
    callbackMode: env.DATAFORSEO_CALLBACK_MODE,
    callbackUrls: {
      pingback: `${env.APP_URL}/api/providers/dataforseo/pingback`,
      postback: `${env.APP_URL}/api/providers/dataforseo/postback`,
    },
    spend: names.map((provider) => ({
      provider,
      todayCents: spend(today, provider),
      monthCents: spend(month, provider),
    })),
  };
}

/** Asks a provider if it can be reached (no cost). The mock always answers yes. */
export async function testProviderConnection(_admin: AdminContext, name: string) {
  if (name !== "mock" && name !== "dataforseo") throw new NotFoundError("Unknown provider.");
  try {
    return await getProviderByName(name).testConnection();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The check failed." };
  }
}
