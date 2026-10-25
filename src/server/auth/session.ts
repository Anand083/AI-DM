import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rawDb } from "@/server/db/client";
import { getAuth } from "./better-auth";
import { readActiveImpersonation } from "./impersonation";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  timezone: string;
  /** Set when a super admin is looking at an agency as this user. The admin's own id. */
  impersonatorUserId?: string;
  /** The agency and end time of that support session. */
  impersonation?: { agencyId: string; expiresAt: Date };
};

/** The person who really signed in, ignoring any support session. Admin pages use this one. */
export async function getRealSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return (session?.user as SessionUser | undefined) ?? null;
}

/**
 * The signed-in user, or null. During a support session a super admin gets the user they are
 * looking at, so the whole app behaves exactly as it does for that person.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const real = await getRealSessionUser();
  if (!real?.isSuperAdmin) return real;
  const support = await readActiveImpersonation();
  if (!support || support.adminUserId !== real.id) return real;
  const target = await rawDb.user.findUnique({ where: { id: support.targetUserId } });
  if (!target) return real;
  return {
    id: target.id,
    name: target.name,
    email: target.email,
    emailVerified: target.emailVerified,
    isSuperAdmin: false,
    timezone: target.timezone,
    impersonatorUserId: real.id,
    impersonation: { agencyId: support.agencyId, expiresAt: support.expiresAt },
  };
}

/** For pages and actions that need a signed-in, verified user. Redirects to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !user.emailVerified) redirect("/login");
  return user;
}
