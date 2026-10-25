"use server";

import { headers } from "next/headers";
import { clientIp } from "@/server/auth/auth-rate-limit";
import { logger } from "@/server/logger";
import { allow } from "@/server/request-limit";
import { AppError } from "@/server/services/errors";
import { submitContactMessage } from "@/server/services/contact";

type Result = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * The public contact form. There is no signed-in user, so it is limited by IP address
 * (5 messages an hour) and has a hidden field that catches simple bots.
 */
export async function sendContactMessageAction(values: unknown): Promise<Result> {
  try {
    const ip = clientIp(await headers());
    const limit = await allow(`contact:${ip}`, 5, 3600);
    if (!limit.allowed) {
      return { ok: false, error: "You sent a few messages already. Please try again later." };
    }
    await submitContactMessage(values, { ip });
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    logger.error({ err: error }, "contact form failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
