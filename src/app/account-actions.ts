"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentSessionId, getRealSessionUser } from "@/server/auth/session";
import { getEnv } from "@/env";
import { logger } from "@/server/logger";
import { mutationAllowed } from "@/server/request-limit";
import { AppError } from "@/server/services/errors";
import { revokeOtherSessions, revokeSession } from "@/server/services/sessions";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  try {
    const user = await getRealSessionUser();
    if (!user || !user.emailVerified) return { ok: false, error: "Please sign in again." };
    if (!(await mutationAllowed(user.id, getEnv().MUTATION_RATE_LIMIT_PER_MINUTE))) {
      return {
        ok: false,
        error: "You are doing that too fast. Please wait a minute and try again.",
      };
    }
    const data = await fn(user.id);
    revalidatePath("/account/security");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message };
    logger.error({ err: error }, "account action failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const id = z.string().min(1).max(100);

export async function revokeSessionAction(sessionId: string) {
  const parsed = id.safeParse(sessionId);
  if (!parsed.success) return { ok: false, error: "Session not found." } as const;
  return run((userId) => revokeSession(userId, parsed.data));
}

export async function revokeOtherSessionsAction() {
  return run(async (userId) => revokeOtherSessions(userId, await getCurrentSessionId()));
}
