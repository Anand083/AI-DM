import type { UsageMetric } from "@prisma/client";
import { LimitExceededError } from "./errors";
import type { GatewayGuard } from "./seo-gateway";

/**
 * The gateway guard (plan Steps 7 and 9). Before every real provider call it checks
 * (1) the platform budget is not used up and (2) the agency is inside its plan limit.
 * Cached answers never reach this code.
 */
export function createSeoGuard(deps: {
  isPaused: () => Promise<boolean>;
  assertWithinLimit: (
    agency: { agencyId: string },
    metric: UsageMetric,
    units: number,
  ) => Promise<void>;
}): GatewayGuard {
  return {
    async beforeCall({ caller, metric, units }) {
      if (await deps.isPaused()) {
        // Do not show money amounts to agencies.
        throw new LimitExceededError(
          "New data requests are paused for now. Please try again later.",
        );
      }
      await deps.assertWithinLimit({ agencyId: caller.agencyId }, metric, units);
    },
  };
}
