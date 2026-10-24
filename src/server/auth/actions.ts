import "server-only";
import type { z } from "zod";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { can, type Action } from "./permissions";
import { getSessionUser, type SessionUser } from "./session";
import { loadTenantContext, type TenantContext } from "./tenant-context";

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ActionDeps = {
  getUser: () => Promise<SessionUser | null>;
  loadContext: (userId: string, agencySlug: string) => Promise<TenantContext | null>;
};

const defaultDeps: ActionDeps = { getUser: getSessionUser, loadContext: loadTenantContext };

/**
 * Wraps a server action for an agency. Every call, in this order:
 *  1. checks the user is signed in and has a verified email,
 *  2. loads the tenant context (not a member or no such agency gives "Not found"),
 *  3. checks the permission with `can()`,
 *  4. validates the input with Zod,
 *  5. runs the handler and turns known errors into a plain result.
 *
 * Usage: `export const inviteAction = withTenantAction({ permission: "team.manage", schema }, handler)`
 * and call it as `inviteAction(agencySlug, input)`.
 */
export function withTenantAction<S extends z.ZodType, R = undefined>(
  config: { permission: Action; schema: S },
  handler: (ctx: TenantContext, input: z.output<S>) => Promise<R>,
  deps: ActionDeps = defaultDeps,
): (agencySlug: string, rawInput: unknown) => Promise<ActionResult<R>> {
  return async (agencySlug, rawInput) => {
    try {
      const user = await deps.getUser();
      if (!user || !user.emailVerified) return { ok: false, error: "Please sign in again." };

      const ctx = await deps.loadContext(user.id, agencySlug);
      if (!ctx) return { ok: false, error: "Not found." };

      if (!can(ctx.role, config.permission)) {
        return { ok: false, error: "You do not have permission to do this." };
      }

      const parsed = config.schema.safeParse(rawInput);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".");
          if (key) fieldErrors[key] ??= issue.message;
        }
        return { ok: false, error: "Please check the form.", fieldErrors };
      }

      return { ok: true, data: await handler(ctx, parsed.data) };
    } catch (error) {
      if (error instanceof AppError) {
        return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
      }
      logger.error({ err: error }, "server action failed");
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}
