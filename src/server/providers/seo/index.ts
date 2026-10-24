import "server-only";
import { getEnv } from "@/env";
import { DataForSeoProvider } from "./dataforseo";
import { MockSeoProvider } from "./mock";
import { parseOverrides, resolveProviderName, type ProviderName } from "./overrides";
import type { SeoDataProvider, SeoModule } from "./types";

export type { SeoDataProvider, SeoModule } from "./types";

const instances = new Map<ProviderName, SeoDataProvider>();

function create(name: ProviderName): SeoDataProvider {
  const env = getEnv();
  if (name === "dataforseo") {
    return new DataForSeoProvider({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      baseUrl: env.DATAFORSEO_BASE_URL,
    });
  }
  return new MockSeoProvider({
    latencyMs: env.MOCK_LATENCY_MS,
    failureRate: env.MOCK_FAILURE_RATE,
    auditSeconds: env.MOCK_AUDIT_SECONDS,
  });
}

/** Which provider a module uses: `SEO_PROVIDER_OVERRIDES` for that module, else `SEO_PROVIDER`. */
export function getSeoProviderName(module?: SeoModule): ProviderName {
  const env = getEnv();
  return resolveProviderName(
    module,
    env.SEO_PROVIDER,
    parseOverrides(env.SEO_PROVIDER_OVERRIDES).overrides,
  );
}

export function getSeoProvider(module?: SeoModule): SeoDataProvider {
  return getProviderByName(getSeoProviderName(module));
}

/** A provider by name, for work that is tied to a provider (for example pending tasks). */
export function getProviderByName(name: ProviderName): SeoDataProvider {
  let provider = instances.get(name);
  if (!provider) {
    provider = create(name);
    instances.set(name, provider);
  }
  return provider;
}
