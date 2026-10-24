import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { can, type Action } from "./permissions";
import { requireUser } from "./session";
import { loadTenantContext, type TenantContext } from "./tenant-context";

/**
 * For pages and layouts under `/app/[agencySlug]`: the signed-in user and the tenant context.
 * Shows the 404 page for non-members. Cached per request, so the layout and the page share it.
 */
export const getPageContext = cache(async (agencySlug: string) => {
  const user = await requireUser();
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) notFound();
  return { user, ctx };
});

/** Pages must check their own permission. The layout alone is not enough. */
export function requirePermission(ctx: TenantContext, action: Action): void {
  if (!can(ctx.role, action)) notFound();
}
