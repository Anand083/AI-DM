import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/app/report-view";
import { pageLimited } from "@/server/request-limit";
import { getSharedReport } from "@/server/services/shared-reports";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/** Public pages never use the platform name. The title is the agency's name and the report title. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shared = await getSharedReport((await params).token);
  if (!shared) return { title: { absolute: "Not found" }, robots: { index: false, follow: false } };
  return {
    title: { absolute: `${shared.title} | ${shared.branding.displayName}` },
    description: `Report from ${shared.branding.displayName}`,
    robots: { index: false, follow: false },
  };
}

export default async function SharedReportPage({ params }: Props) {
  const { token } = await params;
  if (await pageLimited("share-page", 120)) {
    return (
      <main className="p-8 text-center text-sm">
        Too many visits. Please wait a minute and try again.
      </main>
    );
  }
  const shared = await getSharedReport(token);
  if (!shared) notFound();
  const { branding } = shared;
  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8">
      <ReportView
        model={shared.model}
        brand={{
          displayName: branding.displayName,
          primaryColor: branding.primaryColor,
          accentColor: branding.accentColor,
          website: branding.website,
          supportEmail: branding.supportEmail,
          logoUrl: branding.hasLogo ? `/r/${token}/logo?v=${branding.logoVersion ?? "1"}` : null,
        }}
      />
      <p className="mx-auto mt-4 max-w-4xl text-center text-sm">
        <a href={`/r/${token}/pdf`} className="text-zinc-900 underline underline-offset-4">
          Download as PDF
        </a>
      </p>
    </main>
  );
}
