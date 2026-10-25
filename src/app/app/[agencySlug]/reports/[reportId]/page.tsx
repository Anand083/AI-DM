import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportCommentThread } from "@/components/app/report-comments";
import { ReportDelete } from "@/components/app/report-delete";
import { ReportRefresher } from "@/components/app/report-refresher";
import { ReportSharePanel } from "@/components/app/report-share-panel";
import { ReportView } from "@/components/app/report-view";
import { FormMessage } from "@/components/auth/field";
import { buttonClasses } from "@/components/ui/button";
import { getEnv } from "@/env";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getAgency } from "@/server/services/agency";
import { getBranding } from "@/server/services/branding";
import { NotFoundError } from "@/server/services/errors";
import { listReportComments } from "@/server/services/report-comments";
import { getReport } from "@/server/services/reports";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ agencySlug: string; reportId: string }>;
}) {
  const { agencySlug, reportId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const report = await getReport(ctx, reportId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [branding, agency] = await Promise.all([getBranding(ctx), getAgency(ctx)]);
  const comments = await listReportComments(ctx, reportId);
  const canCreate = can(ctx.role, "reports.create");
  const building = report.status === "QUEUED" || report.status === "GENERATING";
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: agency.timezone }).format(d);
  const shareUrl =
    report.shareToken && report.shareExpiresAt && report.shareExpiresAt > new Date()
      ? `${getEnv().APP_URL}/r/${report.shareToken}`
      : null;

  return (
    <div className="space-y-6">
      <ReportRefresher active={building} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/app/${agencySlug}/reports`}
            className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
          >
            All reports
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{report.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {report.status === "READY" && can(ctx.role, "reports.download") ? (
            <a href={`/app/${agencySlug}/reports/${report.id}/pdf`} className={buttonClasses()}>
              Download PDF
            </a>
          ) : null}
          {canCreate ? (
            <ReportDelete agencySlug={agencySlug} reportId={report.id} goToList />
          ) : null}
        </div>
      </div>

      {building ? (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          The report is being built. This page updates by itself.
        </p>
      ) : null}
      {report.status === "FAILED" ? (
        <FormMessage kind="error">
          {report.error ?? "The report could not be built."} Delete it and create a new one to try
          again.
        </FormMessage>
      ) : null}

      {report.status === "READY" && canCreate ? (
        <ReportSharePanel
          agencySlug={agencySlug}
          reportId={report.id}
          shareUrl={shareUrl}
          expiresLabel={report.shareExpiresAt ? date(report.shareExpiresAt) : null}
        />
      ) : null}

      {report.model ? (
        <ReportView
          titleTag="h2"
          model={report.model}
          brand={{
            displayName: branding.displayName,
            primaryColor: branding.primaryColor,
            accentColor: branding.accentColor,
            website: branding.website,
            supportEmail: branding.supportEmail,
            logoUrl: branding.hasLogo
              ? `/app/${agencySlug}/branding/logo?v=${branding.logoVersion ?? "1"}`
              : null,
          }}
        />
      ) : null}
      {report.status === "READY" ? (
        <ReportCommentThread
          kind="team"
          agencySlug={agencySlug}
          reportId={report.id}
          canPost={can(ctx.role, "content.edit")}
          comments={comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
        />
      ) : null}
    </div>
  );
}
