import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "./session";
import { loadPortalContext, loadTenantContext } from "./tenant-context";

/**
 * For portal pages: the signed-in client user and what they may see. Not signed in goes to the
 * agency's portal login. Team members are sent to the agency app. Anyone else gets a 404.
 */
export const getPortalPageContext = cache(async (agencySlug: string) => {
  const user = await getSessionUser();
  if (!user || !user.emailVerified) redirect(`/portal/${agencySlug}/login`);
  const ctx = await loadPortalContext(user.id, agencySlug);
  if (!ctx) {
    if (await loadTenantContext(user.id, agencySlug)) redirect(`/app/${agencySlug}`);
    notFound();
  }
  return { user, ctx };
});
