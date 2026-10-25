import "server-only";
import sharp from "sharp";
import { assembleReport } from "@/lib/report-assembler";
import { pickPositions, START_LOOKBACK_DAYS, type PeriodCheck } from "@/lib/report-data";
import {
  RANKINGS_LIMIT,
  type ReportAuditInput,
  type ReportInput,
  type ReportKeywordRow,
  type ReportModel,
  type ReportSectionKey,
} from "@/lib/report-model";
import { formatDay } from "@/lib/report-period";
import { issueInfo } from "@/server/audit/issue-catalog";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getStorage } from "@/server/providers/storage";
import { getSummaryProvider } from "@/server/providers/summary";
import { renderReportPdf, type PdfBranding } from "@/server/reports/pdf";
import { loadBranding, readLogo } from "./branding";
import { deliverScheduledReport, type SendEmail } from "./report-delivery";

const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/** Reads the rankings and the audit for a report's project and period. */
export async function loadReportInput(agencyId: string, reportId: string): Promise<ReportInput> {
  const report = await db.report.findFirstOrThrow({
    where: { id: reportId, agencyId },
    include: {
      project: {
        select: { id: true, name: true, domain: true, client: { select: { name: true } } },
      },
    },
  });
  const period = {
    start: day(report.periodStart),
    end: day(report.periodEnd),
    label: `${formatDay(day(report.periodStart))} to ${formatDay(day(report.periodEnd))}`,
  };

  const keywords = await db.keyword.findMany({
    where: { agencyId, projectId: report.projectId },
    select: { id: true, phrase: true },
    orderBy: { phrase: "asc" },
    take: RANKINGS_LIMIT,
  });
  const checks = await db.rankCheck.findMany({
    where: {
      agencyId,
      keywordId: { in: keywords.map((k) => k.id) },
      date: {
        gte: new Date(report.periodStart.getTime() - START_LOOKBACK_DAYS * DAY_MS),
        lte: report.periodEnd,
      },
    },
    select: { keywordId: true, date: true, position: true, rankingUrl: true },
    orderBy: { date: "asc" },
    take: RANKINGS_LIMIT * (START_LOOKBACK_DAYS + 372),
  });
  const byKeyword = new Map<string, PeriodCheck[]>();
  for (const c of checks) {
    const list = byKeyword.get(c.keywordId) ?? [];
    list.push({ date: day(c.date), position: c.position, rankingUrl: c.rankingUrl });
    byKeyword.set(c.keywordId, list);
  }
  const rows: ReportKeywordRow[] = keywords.map((k) => ({
    phrase: k.phrase,
    ...pickPositions(byKeyword.get(k.id) ?? [], period),
  }));

  return {
    title: report.title,
    projectName: report.project.name,
    clientName: report.project.client.name,
    domain: report.project.domain,
    period,
    sections: report.sections as ReportSectionKey[],
    notes: report.notes,
    keywords: rows,
    audit: await loadAudit(agencyId, report.projectId, report.periodEnd),
    generatedOn: day(new Date()),
  };
}

/** The last finished audit up to the end of the period, with the score of the one before it. */
async function loadAudit(
  agencyId: string,
  projectId: string,
  periodEnd: Date,
): Promise<ReportAuditInput | null> {
  const audits = await db.audit.findMany({
    where: {
      agencyId,
      projectId,
      status: "COMPLETED",
      finishedAt: { lt: new Date(periodEnd.getTime() + DAY_MS) },
    },
    select: { id: true, healthScore: true, pagesCrawled: true, counts: true, finishedAt: true },
    orderBy: { finishedAt: "desc" },
    take: 2,
  });
  const latest = audits[0];
  if (!latest || latest.healthScore === null || !latest.finishedAt) return null;
  const counts = (latest.counts ?? {}) as { critical?: number; warning?: number; notice?: number };
  const groups = await db.auditIssue.groupBy({
    by: ["code"],
    where: { agencyId, auditId: latest.id },
    _count: { _all: true },
    orderBy: { code: "asc" },
    take: 200,
  });
  return {
    finishedOn: day(latest.finishedAt),
    healthScore: latest.healthScore,
    pagesCrawled: latest.pagesCrawled,
    counts: {
      critical: counts.critical ?? 0,
      warning: counts.warning ?? 0,
      notice: counts.notice ?? 0,
    },
    previousScore: audits[1]?.healthScore ?? null,
    issues: groups.map((g) => {
      const info = issueInfo(g.code);
      return {
        code: g.code,
        title: info.title,
        severity: info.severity,
        pages: g._count._all,
        fix: info.fix,
      };
    }),
  };
}

/** The agency's name, colours and logo, ready for the PDF. WebP logos are converted to PNG. */
export async function loadPdfBranding(agencyId: string): Promise<PdfBranding> {
  const branding = await loadBranding(agencyId);
  let logo: Buffer | null = null;
  const file = await readLogo(agencyId);
  if (file) {
    logo =
      file.contentType === "image/webp" ? await sharp(file.bytes).png().toBuffer() : file.bytes;
  }
  return {
    displayName: branding.displayName,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    website: branding.website,
    supportEmail: branding.supportEmail,
    logo,
  };
}

export function reportPdfKey(agencyId: string, reportId: string): string {
  return `reports/${agencyId}/${reportId}.pdf`;
}

/**
 * Builds a report: reads the data, writes the summary, draws the PDF and saves it.
 * Safe to run twice for the same report. Errors are saved on the report when
 * `finalAttempt` is true, otherwise they are thrown so the job is retried.
 */
export async function generateReport(
  agencyId: string,
  reportId: string,
  options: {
    finalAttempt?: boolean;
    /** How scheduled-report emails are sent. Tests pass their own. */
    send?: SendEmail;
  } = {},
): Promise<{ status: "READY" | "FAILED" | "SKIPPED" }> {
  const report = await db.report.findFirst({
    where: { id: reportId, agencyId },
    select: { id: true, status: true },
  });
  if (!report) return { status: "SKIPPED" };
  await db.report.updateMany({
    where: { id: reportId, agencyId },
    data: { status: "GENERATING", error: null },
  });
  try {
    const input = await loadReportInput(agencyId, reportId);
    const assembled = assembleReport(input);
    const summary = await getSummaryProvider().write(assembled);
    const model: ReportModel = { ...assembled, summary };
    const pdf = await renderReportPdf(model, await loadPdfBranding(agencyId));
    const key = reportPdfKey(agencyId, reportId);
    await getStorage().put(key, pdf, "application/pdf");
    await db.report.updateMany({
      where: { id: reportId, agencyId },
      data: {
        status: "READY",
        data: model as unknown as object,
        pdfKey: key,
        pdfBytes: pdf.length,
        generatedAt: new Date(),
        error: null,
      },
    });
  } catch (error) {
    logger.error({ err: error, reportId }, "report generation failed");
    if (!options.finalAttempt) throw error;
    await db.report.updateMany({
      where: { id: reportId, agencyId },
      data: { status: "FAILED", error: "The report could not be built. Please try again." },
    });
    return { status: "FAILED" };
  }
  // A scheduled report is emailed once it is ready. A failure here retries the job without
  // touching the finished report.
  await deliverScheduledReport(agencyId, reportId, { send: options.send });
  return { status: "READY" };
}
