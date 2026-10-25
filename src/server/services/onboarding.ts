import "server-only";
import { buildChecklist, checklistProgress, type ChecklistItem } from "@/lib/onboarding";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";

export type OnboardingState = {
  items: ChecklistItem[];
  done: number;
  total: number;
  complete: boolean;
  next: ChecklistItem | null;
};

/**
 * The "get started" checklist for the dashboard. Only people who can add things see it. The
 * state comes from the data itself (what the agency has created), so nothing needs saving.
 */
export async function getOnboardingState(ctx: TenantContext): Promise<OnboardingState | null> {
  if (!can(ctx.role, "content.edit")) return null;
  const where = { agencyId: ctx.agencyId };
  const [clients, projects, keywords, audits, branding, reports] = await Promise.all([
    db.client.count({ where: { ...where, deletedAt: null } }),
    db.project.count({ where: { ...where, deletedAt: null } }),
    db.keyword.count({ where }),
    db.audit.count({ where }),
    db.branding.count({ where }),
    db.report.count({ where }),
  ]);
  const items = buildChecklist(
    { clients, projects, keywords, audits, branded: branding > 0, reports },
    `/app/${await slugOf(ctx.agencyId)}`,
  );
  return { items, ...checklistProgress(items) };
}

async function slugOf(agencyId: string): Promise<string> {
  const agency = await db.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { slug: true },
  });
  return agency.slug;
}
