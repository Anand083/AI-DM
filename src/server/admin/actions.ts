import "server-only";
import type { z } from "zod";
import { logger } from "@/server/logger";
import { getRealSessionUser } from "@/server/auth/session";
import { AppError } from "@/server/services/errors";
import type { AdminContext } from "./guard";

export type AdminResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Wraps an admin server action: the caller must be a real super admin (checked here, on every
 * call), the input is validated with Zod, and known errors become plain messages.
 */
export function withAdminAction<S extends z.ZodType, R = undefined>(
  schema: S,
  handler: (admin: AdminContext, input: z.output<S>) => Promise<R>,
): (rawInput: unknown) => Promise<AdminResult<R>> {
  return async (rawInput) => {
    try {
      const user = await getRealSessionUser();
      if (!user || !user.emailVerified || !user.isSuperAdmin) {
        return { ok: false, error: "Not found." };
      }
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".");
          if (key) fieldErrors[key] ??= issue.message;
        }
        return {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Please check the form.",
          fieldErrors,
        };
      }
      return {
        ok: true,
        data: await handler({ adminUserId: user.id, email: user.email }, parsed.data),
      };
    } catch (error) {
      if (error instanceof AppError) {
        return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
      }
      logger.error({ err: error }, "admin action failed");
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}
