import "server-only";
import { render } from "@react-email/components";
import { getEnv } from "@/env";
import { ReportReady } from "@/emails/report-ready";
import type { ReportModel } from "@/lib/report-model";
import { generateToken } from "@/server/tokens";
import { db } from "@/server/db/client";
import { enqueueEmail } from "@/server/jobs/enqueue";
import { getStorage } from "@/server/providers/storage";
import { loadBranding } from "./branding";
import { pdfFileName } from "@/server/reports/pdf-response";

/** PDFs bigger than this are not attached. The email links to the online report instead. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const LINK_DAYS = 30;

export type SendEmail = typeof enqueueEmail;
type Send = SendEmail;

/**
 * Emails a finished scheduled report to the schedule's recipients. Safe to call twice: the report
 * is marked as delivered first, and each email has its own job id.
 */
export async function deliverScheduledReport(
  agencyId: string,
  reportId: string,
  options: { send?: Send; now?: Date } = {},
): Promise<{ sent: number }> {
  const send = options.send ?? enqueueEmail;
  const now = options.now ?? new Date();
  const report = await db.report.findFirst({
    where: {
      id: reportId,
      agencyId,
      status: "READY",
      deliveredAt: null,
      scheduleId: { not: null },
    },
    select: {
      id: true,
      title: true,
      scheduleId: true,
      data: true,
      pdfKey: true,
      periodEnd: true,
      shareToken: true,
    },
  });
  if (!report?.data || !report.pdfKey) return { sent: 0 };
  const schedule = await db.reportSchedule.findFirst({
    where: { id: report.scheduleId!, agencyId },
    select: { recipients: true },
  });
  if (!schedule || schedule.recipients.length === 0) return { sent: 0 };

  const claimed = await db.report.updateMany({
    where: { id: report.id, agencyId, deliveredAt: null },
    data: { deliveredAt: now },
  });
  if (claimed.count === 0) return { sent: 0 };

  try {
    const model = report.data as unknown as ReportModel;
    const branding = await loadBranding(agencyId);
    const file = await getStorage().get(report.pdfKey);
    if (!file) throw new Error("The report PDF is missing.");
    const attach = file.bytes.length <= MAX_ATTACHMENT_BYTES;

    let url: string | undefined;
    if (!attach) {
      const token = report.shareToken ?? generateToken(24);
      await db.report.updateMany({
        where: { id: report.id, agencyId },
        data: {
          shareToken: token,
          shareExpiresAt: new Date(now.getTime() + LINK_DAYS * 86_400_000),
        },
      });
      url = `${getEnv().APP_URL}/r/${token}`;
    }

    const props = {
      brandName: branding.displayName,
      projectName: model.projectName,
      periodLabel: model.period.label,
      summary: model.summary,
      url,
      attached: attach,
      supportEmail: branding.supportEmail,
    };
    const element = ReportReady(props);
    const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
    for (const to of schedule.recipients) {
      await send(
        {
          to,
          subject: `${model.projectName} report: ${model.period.label}`,
          html,
          text,
          fromName: branding.displayName,
          replyTo: branding.supportEmail ?? undefined,
          attachments: attach
            ? [
                {
                  filename: pdfFileName(report.title, model.period.end),
                  contentType: "application/pdf",
                  contentBase64: file.bytes.toString("base64"),
                },
              ]
            : undefined,
        },
        `report_${report.id}_${to}`,
      );
    }
    return { sent: schedule.recipients.length };
  } catch (error) {
    await db.report.updateMany({ where: { id: report.id, agencyId }, data: { deliveredAt: null } });
    throw error;
  }
}
