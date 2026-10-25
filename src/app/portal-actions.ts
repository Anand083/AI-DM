"use server";

import { headers } from "next/headers";
import { z } from "zod";
import type { ActionResult } from "@/server/auth/actions";
import { getAuth } from "@/server/auth/better-auth";
import { getSessionUser } from "@/server/auth/session";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { createClientAccount } from "@/server/services/portal-invite";
import { acceptInvitation } from "@/server/services/team";

const schema = z.object({
  agencySlug: z.string().min(1).max(100),
  token: z.string().min(20).max(200),
  name: z.string().max(100).optional(),
  password: z.string().max(128).optional(),
});

/**
 * Accepts a client invitation from the portal. A new person gives a name and password, and gets
 * an account (no platform email). Someone who already has an account must be signed in first.
 */
export async function acceptPortalInviteAction(
  values: unknown,
): Promise<ActionResult<{ agencySlug: string }>> {
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "This invitation is not valid." };
  const { agencySlug, token, name, password } = parsed.data;
  try {
    if (name !== undefined && password !== undefined) {
      const { email } = await createClientAccount(agencySlug, token, { name, password });
      // The sign-in sets the cookie for the next request. Use the user it returns for this one.
      const signedIn = await getAuth().api.signInEmail({
        body: { email, password },
        headers: await headers(),
      });
      await acceptInvitation(
        { id: signedIn.user.id, email: signedIn.user.email, emailVerified: true },
        token,
      );
      return { ok: true, data: { agencySlug } };
    }
    const user = await getSessionUser();
    if (!user) return { ok: false, error: "Please sign in first." };
    await acceptInvitation(user, token);
    return { ok: true, data: { agencySlug } };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    logger.error({ err: error }, "portal invitation failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
