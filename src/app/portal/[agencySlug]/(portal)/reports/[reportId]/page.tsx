import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportCommentThread } from "@/components/app/report-comments";
import { ReportView } from "@/components/app/report-view";
import { getPortalPageContext } from "@/server/auth/portal-context";
import { NotFoundError } from "@/server/services/errors";
import { getPortalReport } from "@/server/services/portal";
import { listPortalReportComments } from "@/server/services/portal-tasks";
import { loadPortalBrand } from "@/server/services/portal-brand";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

export default async function PortalReportPage({
  params,
}: {
  params: Promise<{ agencySlug: string; reportId: string }>;
}) {
  const { agencySlug, reportId } = await params;
  const { ctx } = await getPortalPageContext(agencySlug);
  const report = await getPortalReport(ctx, reportId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const comments = await listPortalReportComments(ctx, reportId);
  const brand = await loadPortalBrand(agencySlug);
  if (!brand) notFound();
  const base = `/portal/${agencySlug}`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`${base}/reports`} className="text-sm underline underline-offset-4">
          All reports
        </Link>
        <a
          href={`${base}/reports/${report.id}/pdf`}
          className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium"
          style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
        >
          Download PDF
        </a>
      </div>
      <ReportView
        titleTag="h1"
        model={report.model}
        brand={{
          displayName: brand.displayName,
          primaryColor: brand.primaryColor,
          accentColor: brand.accentColor,
          website: brand.website,
          supportEmail: brand.supportEmail,
          logoUrl: brand.hasLogo ? `${base}/logo?v=${brand.logoVersion ?? "1"}` : null,
        }}
      />
      <ReportCommentThread
        kind="portal"
        agencySlug={agencySlug}
        reportId={report.id}
        canPost
        comments={comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      />
    </>
  );
}
