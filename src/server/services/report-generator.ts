import "server-only";
import sharp from "sharp";
import { engineLabel, sortByEngine, summarizeChecks } from "@/lib/ai-visibility";
import { summarizeCompetitors } from "@/lib/competitors";
import { assembleReport } from "@/lib/report-assembler";
import { pickPositions, START_LOOKBACK_DAYS, type PeriodCheck } from "@/lib/report-data";
import {
  RANKINGS_LIMIT,
  type ReportAiInput,
  type ReportAuditInput,
  type ReportBacklinkRow,
  type ReportBacklinksInput,
  type ReportCompetitorsInput,
  type ReportReviewsInput,
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
import { loadComparisonRows } from "./competitors";
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
    backlinks: (report.sections as string[]).includes("backlinks")
      ? await loadBacklinks(agencyId, report.projectId, report.periodStart, report.periodEnd)
      : null,
    competitors: (report.sections as string[]).includes("competitors")
      ? await loadCompetitors(agencyId, report.projectId)
      : null,
    ai: (report.sections as string[]).includes("ai")
      ? await loadAiVisibility(agencyId, report.projectId, report.periodEnd)
      : null,
    reviews: (report.sections as string[]).includes("reviews")
      ? await loadReviews(agencyId, report.projectId, report.periodStart, report.periodEnd)
      : null,
    generatedOn: day(new Date()),
  };
}

/** The business rating from the last check up to the end of the period, and the period's reviews. */
async function loadReviews(
  agencyId: string,
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportReviewsInput | null> {
  const business = await db.localBusiness.findFirst({
    where: { agencyId, projectId },
    select: { name: true, city: true },
  });
  if (!business) return null;
  const latest = await db.reviewSnapshot.findFirst({
    where: { agencyId, projectId, takenOn: { lte: periodEnd } },
    orderBy: { takenOn: "desc" },
  });
  if (!latest) return null;
  const before = await db.reviewSnapshot.findFirst({
    where: { agencyId, projectId, takenOn: { lte: periodStart } },
    orderBy: { takenOn: "desc" },
    select: { ratingTenths: true, takenOn: true },
  });
  const inPeriod = { gt: periodStart, lte: periodEnd };
  const [newInPeriod, lowInPeriod, newest] = await Promise.all([
    db.review.count({ where: { agencyId, projectId, publishedAt: inPeriod } }),
    db.review.count({ where: { agencyId, projectId, publishedAt: inPeriod, rating: { lte: 2 } } }),
    db.review.findMany({
      where: { agencyId, projectId, publishedAt: { lte: periodEnd } },
      select: { author: true, rating: true, text: true, publishedAt: true },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 3,
    }),
  ]);
  return {
    businessName: business.name,
    city: business.city,
    checkedOn: day(latest.takenOn),
    ratingTenths: latest.ratingTenths,
    reviewCount: latest.reviewCount,
    ratingChangeTenths:
      before && before.takenOn < latest.takenOn ? latest.ratingTenths - before.ratingTenths : null,
    newInPeriod,
    lowInPeriod,
    latest: newest.map((r) => ({
      author: r.author,
      rating: r.rating,
      text: r.text,
      publishedAt: day(r.publishedAt),
    })),
  };
}

/** The last AI visibility check up to the end of the period, with the rate of the one before. */
async function loadAiVisibility(
  agencyId: string,
  projectId: string,
  periodEnd: Date,
): Promise<ReportAiInput | null> {
  const days = await db.aiVisibilityCheck.findMany({
    where: { agencyId, projectId, checkedOn: { lte: periodEnd } },
    select: { checkedOn: true },
    distinct: ["checkedOn"],
    orderBy: { checkedOn: "desc" },
    take: 2,
  });
  const latestOn = days[0]?.checkedOn;
  if (!latestOn) return null;
  const select = {
    promptId: true,
    engine: true,
    brandMentioned: true,
    domainCited: true,
    mentionPosition: true,
    competitorsMentioned: true,
  } as const;
  const [latest, before, prompts] = await Promise.all([
    db.aiVisibilityCheck.findMany({
      where: { agencyId, projectId, checkedOn: latestOn },
      select,
      take: 1000,
    }),
    days[1]
      ? db.aiVisibilityCheck.findMany({
          where: { agencyId, projectId, checkedOn: days[1].checkedOn },
          select,
          take: 1000,
        })
      : Promise.resolve([]),
    db.aiPrompt.findMany({
      where: { agencyId, projectId },
      select: { id: true, text: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 20,
    }),
  ]);
  const summary = summarizeChecks(latest);
  return {
    checkedOn: day(latestOn),
    total: summary.total,
    mentionRate: summary.mentionRate,
    previousRate: before.length > 0 ? summarizeChecks(before).mentionRate : null,
    citedRate: summary.citedRate,
    shareOfVoice: summary.shareOfVoice,
    averagePosition: summary.averagePosition,
    engines: sortByEngine(Object.entries(summary.byEngine)).map(([engine, e]) => ({
      engine,
      label: engineLabel(engine),
      total: e.total,
      mentionRate: e.mentionRate,
    })),
    prompts: prompts
      .map((p) => {
        const rows = latest.filter((c) => c.promptId === p.id);
        return {
          text: p.text,
          mentioned: rows.filter((c) => c.brandMentioned).length,
          engines: rows.length,
        };
      })
      .filter((p) => p.engines > 0)
      .slice(0, 10),
  };
}

/** The comparison as it stands now (the last rank checks) and the biggest keyword gaps. */
async function loadCompetitors(
  agencyId: string,
  projectId: string,
): Promise<ReportCompetitorsInput | null> {
  const { competitors, rows } = await loadComparisonRows(agencyId, projectId);
  if (competitors.length === 0) return null;
  const gap = await db.competitorKeyword.findMany({
    where: { agencyId, projectId },
    select: {
      keyword: true,
      position: true,
      volume: true,
      competitor: { select: { domain: true } },
    },
    orderBy: [{ volume: "desc" }, { keyword: "asc" }],
    take: 10,
  });
  return {
    compared: rows.length,
    competitors: summarizeCompetitors(
      rows,
      competitors.map((c) => c.domain),
    ),
    gap: gap.map((g) => ({
      keyword: g.keyword,
      competitor: g.competitor.domain,
      position: g.position,
      volume: g.volume,
    })),
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

const topLinks = (
  rows: { sourceDomain: string; anchor: string; dofollow: boolean; sourceRating: number }[],
): ReportBacklinkRow[] =>
  rows.map((r) => ({
    domain: r.sourceDomain,
    anchor: r.anchor,
    dofollow: r.dofollow,
    rating: r.sourceRating,
  }));

/** Backlink numbers from the last weekly check up to the end of the period. */
async function loadBacklinks(
  agencyId: string,
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportBacklinksInput | null> {
  const latest = await db.backlinkSnapshot.findFirst({
    where: { agencyId, projectId, takenOn: { lte: periodEnd } },
    orderBy: { takenOn: "desc" },
  });
  if (!latest) return null;
  const before = await db.backlinkSnapshot.findFirst({
    where: { agencyId, projectId, takenOn: { lte: periodStart } },
    orderBy: { takenOn: "desc" },
    select: { totalBacklinks: true, referringDomains: true, takenOn: true },
  });
  const inPeriod = { gt: periodStart, lte: periodEnd };
  const order = [{ sourceRating: "desc" as const }, { sourceUrl: "asc" as const }];
  const select = { sourceDomain: true, anchor: true, dofollow: true, sourceRating: true };
  const [newInPeriod, lostInPeriod, suspicious, topNew, topLost] = await Promise.all([
    db.backlink.count({ where: { agencyId, projectId, firstSeen: inPeriod } }),
    db.backlink.count({ where: { agencyId, projectId, lostAt: inPeriod } }),
    db.backlink.count({ where: { agencyId, projectId, lostAt: null, suspicious: true } }),
    db.backlink.findMany({
      where: { agencyId, projectId, firstSeen: inPeriod },
      select,
      orderBy: order,
      take: 5,
    }),
    db.backlink.findMany({
      where: { agencyId, projectId, lostAt: inPeriod },
      select,
      orderBy: order,
      take: 5,
    }),
  ]);
  const comparable = before && before.takenOn < latest.takenOn;
  return {
    checkedOn: day(latest.takenOn),
    totalBacklinks: latest.totalBacklinks,
    referringDomains: latest.referringDomains,
    domainRating: latest.domainRating,
    dofollowPercent: latest.dofollowPercent,
    totalChange: comparable ? latest.totalBacklinks - before.totalBacklinks : null,
    domainsChange: comparable ? latest.referringDomains - before.referringDomains : null,
    newInPeriod,
    lostInPeriod,
    suspicious,
    topNew: topLinks(topNew),
    topLost: topLinks(topLost),
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
