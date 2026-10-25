import "server-only";
import { unavailableMessage, type DataFeature } from "@/lib/feature-availability";
import { getSeoProviderName } from "@/server/providers/seo";
import type { SeoModule } from "@/server/providers/seo/types";
import { ConflictError } from "./errors";

const MODULE: Record<DataFeature, SeoModule> = {
  ai: "ai",
  reviews: "reviews",
  listings: "reviews",
};

/** Why a feature cannot run with the configured data source, or null when it can. */
export function featureUnavailable(feature: DataFeature): string | null {
  return unavailableMessage(getSeoProviderName(MODULE[feature]), feature);
}

/** Stops work that could never succeed, with a message people can read. */
export function assertFeatureAvailable(feature: DataFeature): void {
  const message = featureUnavailable(feature);
  if (message) throw new ConflictError(message);
}
