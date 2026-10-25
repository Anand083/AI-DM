"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { saveAuditConfig } from "@/server/services/audit-config";
import { setIssueState } from "@/server/services/audit-issue-state";
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

const config = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: z.unknown() }),
  },
  (ctx, input) => saveAuditConfig(ctx, input.projectId, input.values),
);
const mark = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, values: z.unknown() }),
  },
  (ctx, input) => setIssueState(ctx, input.projectId, input.values),
);

export async function saveAuditConfigAction(slug: string, projectId: string, values: unknown) {
  const result = await config(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/audit`);
  return result;
}

export async function setIssueStateAction(slug: string, projectId: string, values: unknown) {
  const result = await mark(slug, { projectId, values });
  if (result.ok) revalidatePath(`/app/${slug}/projects/${projectId}/audit`, "layout");
  return result;
}
