import "server-only";
import { rawDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { NotFoundError } from "./errors";

export type SessionRow = {
  id: string;
  device: string;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
};

/** A short, readable name for a browser, from its user-agent text. */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(userAgent)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

/** The person's own sessions, newest first. Only their own: the user id comes from the session. */
export async function listSessions(
  userId: string,
  currentSessionId: string | null,
  now = new Date(),
): Promise<SessionRow[]> {
  const rows = await rawDb.session.findMany({
    where: { userId, expiresAt: { gt: now } },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    device: describeDevice(r.userAgent),
    ip: r.ipAddress,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    current: r.id === currentSessionId,
  }));
}

/** Ends one of the person's sessions. A session that belongs to someone else is "not found". */
export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const result = await rawDb.session.deleteMany({ where: { id: sessionId, userId } });
  if (result.count === 0) throw new NotFoundError("Session not found.");
  logger.info({ userId, sessionId }, "session revoked");
}

/** Ends all the person's sessions except the one in use. */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string | null,
): Promise<number> {
  const result = await rawDb.session.deleteMany({
    where: { userId, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
  });
  logger.info({ userId, count: result.count }, "other sessions revoked");
  return result.count;
}
