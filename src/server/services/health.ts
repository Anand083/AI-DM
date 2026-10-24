export type CheckResult = { ok: boolean; error?: string };

export type HealthReport = {
  ok: boolean;
  checks: { database: CheckResult; redis: CheckResult };
};

export type HealthProbes = {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
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
  const [database, redis] = await Promise.all([run(probes.database), run(probes.redis)]);
  return { ok: database.ok && redis.ok, checks: { database, redis } };
}
