import "server-only";
import type { z } from "zod";
import { getEnv } from "@/env";
import { mutationAllowed } from "@/server/request-limit";
import { withTenantAction, type ActionResult } from "./actions";
import { getSessionUser } from "./session";
import { loadPortalContext, type PortalContext } from "./tenant-context";

/**
 * Wraps a server action for a client user of the portal. Same steps as `withTenantAction`
 * (signed in with a verified email, rate limit, permission, input check), but the context is the
 * client's portal context: the agency and only the clients this person was invited to.
 * Team members of the agency are not client users and get "Not found" here.
 */
export function withPortalAction<S extends z.ZodType, R = undefined>(
  schema: S,
  handler: (ctx: PortalContext, input: z.output<S>) => Promise<R>,
): (agencySlug: string, rawInput: unknown) => Promise<ActionResult<R>> {
  return withTenantAction(
    { permission: "data.view", schema },
    (ctx, input) => handler(ctx as PortalContext, input),
    {
      getUser: getSessionUser,
      loadContext: loadPortalContext,
      checkRate: (userId) => mutationAllowed(userId, getEnv().MUTATION_RATE_LIMIT_PER_MINUTE),
    },
  );
}
