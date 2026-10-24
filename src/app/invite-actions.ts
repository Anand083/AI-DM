"use server";

import { z } from "zod";
import type { ActionResult } from "@/server/auth/actions";
import { getSessionUser } from "@/server/auth/session";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { acceptInvitation } from "@/server/services/team";

const tokenSchema = z.string().min(20).max(200);

export async function acceptInvitationAction(
  token: string,
): Promise<ActionResult<{ agencySlug: string }>> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: "Please sign in again." };
    const parsed = tokenSchema.safeParse(token);
    if (!parsed.success) return { ok: false, error: "This invitation is not valid." };
    const { agencySlug } = await acceptInvitation(user, parsed.data);
    return { ok: true, data: { agencySlug } };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message };
    logger.error({ err: error }, "accept invitation failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
