import "server-only";
import { db, rawDb } from "@/server/db/client";
import type { Role } from "./permissions";

/** Everything a service needs to know about who is asking and for which agency. */
export type TenantContext = {
  userId: string;
  agencyId: string;
  role: Role;
  /** For CLIENT users: the clients they may see. */
  clientIds?: string[];
};

/**
 * Loads the context for a team member (OWNER, ADMIN, MEMBER) of the agency with this slug.
 * Returns null when the agency does not exist, is not active, or the user is not a member.
 * Callers should answer with a 404 so nobody can learn which agencies exist.
 */
export async function loadTenantContext(
  userId: string,
  agencySlug: string,
): Promise<TenantContext | null> {
  const agency = await db.agency.findFirst({
    where: { slug: agencySlug, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!agency) return null;
  const member = await db.agencyMember.findFirst({
    where: { agencyId: agency.id, userId },
    select: { role: true },
  });
  if (!member) return null;
  return { userId, agencyId: agency.id, role: member.role };
}

export type UserAgency = { id: string; name: string; slug: string; role: Role };

/**
 * The agencies this user belongs to. This is a lookup by user, across agencies, so it
 * uses the plain client (the tenant guard needs one agencyId per query).
 */
export async function listUserAgencies(userId: string): Promise<UserAgency[]> {
  const rows = await rawDb.agencyMember.findMany({
    where: { userId, agency: { status: "ACTIVE", deletedAt: null } },
    select: { role: true, agency: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return rows.map((r) => ({ ...r.agency, role: r.role }));
}
