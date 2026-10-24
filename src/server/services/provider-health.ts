export type ProviderStatus = { ok: boolean; balanceUsd?: number; message?: string };

type Probe = () => Promise<ProviderStatus>;

/**
 * Remembers each provider's connection status for a few minutes, so the health endpoint
 * does not call the provider on every request. Uses `testConnection()` only (no cost).
 */
export function createProviderHealth(options: {
  probes: Record<string, Probe>;
  ttlMs?: number;
  now?: () => number;
}) {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; status: ProviderStatus }>();

  return async function check(names: string[]): Promise<Record<string, ProviderStatus>> {
    const result: Record<string, ProviderStatus> = {};
    await Promise.all(
      names.map(async (name) => {
        const hit = cache.get(name);
        if (hit && now() - hit.at < ttlMs) {
          result[name] = hit.status;
          return;
        }
        const probe = options.probes[name];
        let status: ProviderStatus;
        try {
          status = probe ? await probe() : { ok: false, message: "Unknown provider" };
        } catch (error) {
          status = { ok: false, message: error instanceof Error ? error.message : "Check failed" };
        }
        cache.set(name, { at: now(), status });
        result[name] = status;
      }),
    );
    return result;
  };
}
