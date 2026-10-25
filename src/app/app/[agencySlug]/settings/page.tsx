import type { Metadata } from "next";
import { DataExportPanel } from "@/components/app/data-export-panel";
import { DeleteAgencyPanel } from "@/components/app/delete-agency-panel";
import { SettingsForm } from "@/components/app/settings-form";
import { can } from "@/server/auth/permissions";
import { getPageContext } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";
import { listExports } from "@/server/services/data-export";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const agency = await getAgency(ctx);
  const canEdit = can(ctx.role, "branding.edit");
  const isOwner = can(ctx.role, "agency.manage");
  const exports = isOwner ? await listExports(ctx) : [];
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: agency.timezone,
    }).format(d);
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {canEdit
          ? "Basic details about your agency."
          : "Only owners and admins can change these details."}
      </p>
      <div className="mt-6">
        <SettingsForm
          agencySlug={agencySlug}
          canEdit={canEdit}
          initial={{
            name: agency.name,
            timezone: agency.timezone,
            alertDropPositions: agency.alertDropPositions,
            alertDropWithin: agency.alertDropWithin,
            alertTopPosition: agency.alertTopPosition,
            alertOnCriticalAudit: agency.alertOnCriticalAudit,
            dailyDigest: agency.dailyDigest,
          }}
          address={`/app/${agency.slug}`}
        />
      </div>
      {isOwner ? (
        <div className="mt-10 space-y-8">
          <DataExportPanel
            agencySlug={agencySlug}
            items={exports.map((e) => ({
              id: e.id,
              status: e.status,
              size: e.bytes
                ? `${Math.max(1, Math.round(e.bytes / 1024)).toLocaleString("en-US")} KB`
                : null,
              created: when(e.createdAt),
              expires: when(e.expiresAt),
            }))}
          />
          <DeleteAgencyPanel agencySlug={agencySlug} agencyName={agency.name} />
        </div>
      ) : null}
    </div>
  );
}
