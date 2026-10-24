import type { PrismaClient } from "@prisma/client";

export const SOFT_DELETE_DAYS = 30;

/**
 * Removes things that are no longer needed: expired cache rows, old sessions and tokens, and
 * clients, projects and agencies that were deleted more than 30 days ago.
 * This is system-wide work, so it uses the plain database client.
 */
export async function purgeExpired(db: PrismaClient, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_DAYS * 86_400_000);
  const [cache, sessions, verifications, projects, clients, agencies] = await Promise.all([
    db.providerCache.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.project.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    db.client.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    db.agency.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
  ]);
  return {
    providerCache: cache.count,
    sessions: sessions.count,
    verifications: verifications.count,
    projects: projects.count,
    clients: clients.count,
    agencies: agencies.count,
  };
}
