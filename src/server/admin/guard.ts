import "server-only";
import { notFound, redirect } from "next/navigation";
import { getRealSessionUser } from "@/server/auth/session";

/** Proof that the caller is a super admin. Services in this folder take one. */
export type AdminContext = { adminUserId: string; email: string };

/**
 * For admin pages and actions: the person who really signed in must be a super admin. Anyone
 * else gets a 404, so the admin area looks like it does not exist. A support session does not
 * count: while looking at an agency as a member, the admin area is closed.
 * A super admin without two-step sign in is sent to set it up first.
 */
export async function requireSuperAdmin(): Promise<AdminContext> {
  const user = await getRealSessionUser();
  if (!user || !user.emailVerified || !user.isSuperAdmin) notFound();
  // Admins must use two-step sign in. Until it is on, the admin area sends them to set it up.
  if (user.twoFactorEnabled !== true) redirect("/account/security?required=1");
  return { adminUserId: user.id, email: user.email };
}
