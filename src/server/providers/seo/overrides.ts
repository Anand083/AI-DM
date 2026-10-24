import { SEO_MODULES, type SeoModule } from "./types";

export type ProviderName = "mock" | "dataforseo";
export type ProviderOverrides = Partial<Record<SeoModule, ProviderName>>;

const PROVIDERS: readonly string[] = ["mock", "dataforseo"];

/**
 * Parses `SEO_PROVIDER_OVERRIDES`, for example "rankings=dataforseo,audit=mock".
 * Returns the overrides and a list of problems (empty when the text is fine).
 */
export function parseOverrides(text: string): { overrides: ProviderOverrides; problems: string[] } {
  const overrides: ProviderOverrides = {};
  const problems: string[] = [];
  for (const part of text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [moduleName, provider, ...extra] = part.split("=").map((p) => p.trim());
    if (!moduleName || !provider || extra.length > 0) {
      problems.push(`"${part}" should look like module=provider`);
    } else if (!(SEO_MODULES as readonly string[]).includes(moduleName)) {
      problems.push(`unknown module "${moduleName}" (use ${SEO_MODULES.join(", ")})`);
    } else if (!PROVIDERS.includes(provider)) {
      problems.push(`unknown provider "${provider}" for ${moduleName} (use mock or dataforseo)`);
    } else {
      overrides[moduleName as SeoModule] = provider as ProviderName;
    }
  }
  return { overrides, problems };
}

/** The provider a module uses: its override, or the default. */
export function resolveProviderName(
  moduleName: SeoModule | undefined,
  defaultProvider: ProviderName,
  overrides: ProviderOverrides,
): ProviderName {
  return (moduleName && overrides[moduleName]) || defaultProvider;
}

/** Every provider that at least one module uses. */
export function providersInUse(
  defaultProvider: ProviderName,
  overrides: ProviderOverrides,
): Set<ProviderName> {
  const used = new Set<ProviderName>();
  for (const name of SEO_MODULES) used.add(resolveProviderName(name, defaultProvider, overrides));
  return used;
}
