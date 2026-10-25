"use server";

import { headers } from "next/headers";
import { clientIp } from "@/server/auth/auth-rate-limit";
import { logger } from "@/server/logger";
import { allow } from "@/server/request-limit";
import { AppError } from "@/server/services/errors";
import { submitLead } from "@/server/services/leads";

type Result =
  | { ok: true; publicId: string | null }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * The widget form. There is no signed-in user, so it is limited by IP address (5 checks an hour
 * for one visitor, and 60 an hour for one agency's widget) and has a hidden field for bots.
 */
export async function submitLeadAction(agencySlug: string, values: unknown): Promise<Result> {
  try {
    if (typeof agencySlug !== "string" || agencySlug.length > 100) {
      return { ok: false, error: "This form is not available." };
    }
    const ip = clientIp(await headers());
    const visitor = await allow(`widget:${agencySlug}:${ip}`, 5, 3600);
    const widget = await allow(`widget-all:${agencySlug}`, 60, 3600);
    if (!visitor.allowed || !widget.allowed) {
      return { ok: false, error: "Too many checks for now. Please try again later." };
    }
    const { publicId } = await submitLead(agencySlug, values);
    return { ok: true, publicId };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    logger.error({ err: error }, "lead widget failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
