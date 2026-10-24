import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./better-auth";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  timezone: string;
};

/** The signed-in user, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return (session?.user as SessionUser | undefined) ?? null;
}

/** For pages and actions that need a signed-in, verified user. Redirects to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !user.emailVerified) redirect("/login");
  return user;
}
