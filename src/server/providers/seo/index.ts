import "server-only";
import { getEnv } from "@/env";
import { DataForSeoProvider } from "./dataforseo";
import { MockSeoProvider } from "./mock";
import type { SeoDataProvider, SeoModule } from "./types";

export type { SeoDataProvider, SeoModule } from "./types";

const instances = new Map<string, SeoDataProvider>();

/**
 * The SEO provider for a module. Today every module uses `SEO_PROVIDER`.
 * Step 8b adds `SEO_PROVIDER_OVERRIDES` so each module can use a different one.
 */
export function getSeoProvider(_module?: SeoModule): SeoDataProvider {
  const env = getEnv();
  const name = env.SEO_PROVIDER;
  let provider = instances.get(name);
  if (!provider) {
    provider =
      name === "dataforseo"
        ? new DataForSeoProvider()
        : new MockSeoProvider({
            latencyMs: env.MOCK_LATENCY_MS,
            failureRate: env.MOCK_FAILURE_RATE,
            auditSeconds: env.MOCK_AUDIT_SECONDS,
          });
    instances.set(name, provider);
  }
  return provider;
}
