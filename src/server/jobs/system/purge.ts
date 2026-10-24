import type { PrismaClient } from "@prisma/client";

export const SOFT_DELETE_DAYS = 30;

/**
 * Removes things that are no longer needed: expired cache rows, old sessions and tokens, and
 * clients, projects and agencies that were deleted more than 30 days ago.
 * This is system-wide work, so it uses the plain database client.
 */
export async function purgeExpired(db: PrismaClient, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_DAYS * 86_400_000);
  const cache = await db.providerCache.deleteMany({ where: { expiresAt: { lt: now } } });
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const verifications = await db.verification.deleteMany({ where: { expiresAt: { lt: now } } });
  // One after the other: deleting a client also deletes its projects, so projects go first
  // to get an honest count.
  const projects = await db.project.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  const clients = await db.client.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  const agencies = await db.agency.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  return {
    providerCache: cache.count,
    sessions: sessions.count,
    verifications: verifications.count,
    projects: projects.count,
    clients: clients.count,
    agencies: agencies.count,
  };
}
