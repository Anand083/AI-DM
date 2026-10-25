import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { can, type Action } from "./permissions";
import { requireUser } from "./session";
import { isSuspendedMember, loadTenantContext, type TenantContext } from "./tenant-context";

/**
 * For pages and layouts under `/app/[agencySlug]`: the signed-in user and the tenant context.
 * Shows the 404 page for non-members. Cached per request, so the layout and the page share it.
 */
export const getPageContext = cache(async (agencySlug: string) => {
  const user = await requireUser();
  const found = await loadTenantContext(user.id, agencySlug);
  if (!found) {
    if (await isSuspendedMember(user.id, agencySlug)) redirect("/app/suspended");
    notFound();
  }
  // A support session only reaches the agency it was started for.
  if (user.impersonation && user.impersonation.agencyId !== found.agencyId) notFound();
  const ctx: TenantContext = { ...found, impersonatorUserId: user.impersonatorUserId };
  return { user, ctx };
});

/** Pages must check their own permission. The layout alone is not enough. */
export function requirePermission(ctx: TenantContext, action: Action): void {
  if (!can(ctx.role, action)) notFound();
}
