"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reportSchema, shareSchema } from "@/lib/schemas/report";
import { withTenantAction } from "@/server/auth/actions";
import { createReport, deleteReport, revokeShare, shareReport } from "@/server/services/reports";

const create = withTenantAction(
  { permission: "reports.create", schema: reportSchema },
  async (ctx, input) => {
    const report = await createReport(ctx, input);
    return { reportId: report.id };
  },
);

const share = withTenantAction(
  { permission: "reports.create", schema: shareSchema },
  async (ctx, input) => {
    const result = await shareReport(ctx, input);
    return { token: result.shareToken, expiresAt: result.shareExpiresAt.toISOString() };
  },
);

const revoke = withTenantAction(
  { permission: "reports.create", schema: z.object({ reportId: z.string().min(1) }) },
  (ctx, input) => revokeShare(ctx, input.reportId),
);

const remove = withTenantAction(
  { permission: "reports.create", schema: z.object({ reportId: z.string().min(1) }) },
  (ctx, input) => deleteReport(ctx, input.reportId),
);

export async function createReportAction(slug: string, values: unknown) {
  const result = await create(slug, values);
  if (result.ok) revalidatePath(`/app/${slug}/reports`);
  return result;
}

export async function shareReportAction(slug: string, reportId: string, days: number) {
  const result = await share(slug, { reportId, days });
  if (result.ok) revalidatePath(`/app/${slug}/reports/${reportId}`);
  return result;
}

export async function revokeShareAction(slug: string, reportId: string) {
  const result = await revoke(slug, { reportId });
  if (result.ok) revalidatePath(`/app/${slug}/reports/${reportId}`);
  return result;
}

export async function deleteReportAction(slug: string, reportId: string) {
  const result = await remove(slug, { reportId });
  if (result.ok) revalidatePath(`/app/${slug}/reports`);
  return result;
}
