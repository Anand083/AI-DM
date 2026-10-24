import type { Metadata } from "next";
import { SettingsForm } from "@/components/app/settings-form";
import { can } from "@/server/auth/permissions";
import { getPageContext } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";

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
    </div>
  );
}
