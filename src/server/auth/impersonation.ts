import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/env";
import { rawDb } from "@/server/db/client";
import { IMPERSONATION_COOKIE, readImpersonationToken } from "./impersonation-token";

export type ActiveImpersonation = {
  id: string;
  adminUserId: string;
  targetUserId: string;
  agencyId: string;
  expiresAt: Date;
};

/**
 * The support session in this request, if there is a valid one: a signed cookie that points at an
 * impersonation row which has not ended or run out. Returns null outside a web request.
 */
export async function readActiveImpersonation(
  now = new Date(),
): Promise<ActiveImpersonation | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  } catch {
    return null;
  }
  const id = readImpersonationToken(token, getEnv().BETTER_AUTH_SECRET);
  if (!id) return null;
  const row = await rawDb.impersonation.findFirst({
    where: { id, endedAt: null, expiresAt: { gt: now } },
    select: { id: true, adminUserId: true, targetUserId: true, agencyId: true, expiresAt: true },
  });
  return row;
}
