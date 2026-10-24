import "server-only";
import type { ReportModel } from "@/lib/report-model";
import { rawDb } from "@/server/db/client";
import { getStorage } from "@/server/providers/storage";
import { loadBranding, readLogo, type BrandingView } from "./branding";

export type SharedReport = {
  agencyId: string;
  title: string;
  periodEnd: string;
  model: ReportModel;
  branding: BrandingView;
  pdfKey: string | null;
};

/**
 * Finds a report by its public share token. Returns null when the token is unknown, the link was
 * turned off, the link has expired or the report is not ready. Callers must treat all of these
 * the same way (404) so nobody can tell them apart.
 * This is the one place that reads a report without an agency: the token is the proof of access.
 */
export async function getSharedReport(
  token: string,
  now: Date = new Date(),
): Promise<SharedReport | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  const report = await rawDb.report.findFirst({
    where: { shareToken: token, shareExpiresAt: { gt: now }, status: "READY" },
    select: { agencyId: true, title: true, periodEnd: true, data: true, pdfKey: true },
  });
  if (!report || !report.data) return null;
  return {
    agencyId: report.agencyId,
    title: report.title,
    periodEnd: report.periodEnd.toISOString().slice(0, 10),
    model: report.data as unknown as ReportModel,
    branding: await loadBranding(report.agencyId),
    pdfKey: report.pdfKey,
  };
}

export async function readSharedPdf(shared: SharedReport): Promise<Buffer | null> {
  if (!shared.pdfKey) return null;
  return (await getStorage().get(shared.pdfKey))?.bytes ?? null;
}

export function readSharedLogo(shared: SharedReport) {
  return readLogo(shared.agencyId);
}
