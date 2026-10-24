export type CheckResult = { ok: boolean; error?: string };

export type HealthReport = {
  /** True when the database and Redis work. Provider problems do not make the app unhealthy. */
  ok: boolean;
  checks: { database: CheckResult; redis: CheckResult };
  providers?: Record<string, { ok: boolean; balanceUsd?: number; message?: string }>;
};

export type HealthProbes = {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
  /** Status of outside services (already cached by the caller). */
  providers?: () => Promise<NonNullable<HealthReport["providers"]>>;
};

const TIMEOUT_MS = 3000;

async function run(probe: () => Promise<unknown>): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      }),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Checks each dependency. Never throws; a failing dependency is reported in the result. */
export async function checkHealth(probes: HealthProbes): Promise<HealthReport> {
  const [database, redis, providers] = await Promise.all([
    run(probes.database),
    run(probes.redis),
    probes.providers ? probes.providers().catch(() => undefined) : undefined,
  ]);
  return {
    ok: database.ok && redis.ok,
    checks: { database, redis },
    ...(providers ? { providers } : {}),
  };
}
