"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { getAuditProgress, startAudit } from "@/server/services/audits";

const idSchema = z.string().min(1).max(100);

const start = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: idSchema }) },
  async (ctx, input) => {
    const audit = await startAudit(ctx, input.projectId);
    return { auditId: audit.id };
  },
);
const progress = withTenantAction(
  { permission: "data.view", schema: z.object({ projectId: idSchema, auditId: idSchema }) },
  (ctx, input) => getAuditProgress(ctx, input.projectId, input.auditId),
);

export async function startAuditAction(slug: string, projectId: string) {
  const result = await start(slug, { projectId });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}`, "layout");
  return result;
}

export async function auditProgressAction(slug: string, projectId: string, auditId: string) {
  return progress(slug, { projectId, auditId });
}
