/** Features that depend on what the chosen data source can give. */
export type DataFeature = "ai" | "reviews" | "listings";

/** What DataForSEO cannot give yet. The mock source gives everything (with sample data). */
const UNSUPPORTED: Record<string, Partial<Record<DataFeature, string>>> = {
  dataforseo: {
    ai: "AI visibility checks are not available with your current data source yet.",
    reviews: "Review tracking is not available with your current data source yet.",
    listings: "Directory listing checks are not available with your current data source yet.",
  },
};

/** A plain-English reason the feature cannot run with this data source, or null when it can. */
export function unavailableMessage(provider: string, feature: DataFeature): string | null {
  return UNSUPPORTED[provider]?.[feature] ?? null;
}
