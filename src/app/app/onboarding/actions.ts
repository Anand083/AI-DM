"use server";

import type { ActionResult } from "@/server/auth/actions";
import { getSessionUser } from "@/server/auth/session";
import { logger } from "@/server/logger";
import { createAgency } from "@/server/services/agency";
import { AppError } from "@/server/services/errors";

export async function createAgencyAction(input: unknown): Promise<ActionResult<{ slug: string }>> {
  try {
    const user = await getSessionUser();
    if (!user || !user.emailVerified) return { ok: false, error: "Please sign in again." };
    const agency = await createAgency(user.id, input);
    return { ok: true, data: { slug: agency.slug } };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    logger.error({ err: error }, "create agency failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
