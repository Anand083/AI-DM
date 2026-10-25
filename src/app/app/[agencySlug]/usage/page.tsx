import type { Metadata } from "next";
import { ADDON_LABEL, type AddOnKey } from "@/lib/plan-limits";
import { PlanBadge, UsageBars } from "@/components/app/usage-bars";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";
import { listAddOns } from "@/server/services/plan";
import { getUsageSummary } from "@/server/services/usage";

export const metadata: Metadata = { title: "Usage" };
export const dynamic = "force-dynamic";

export default async function UsagePage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "branding.edit");
  const [summary, agency, addOns] = await Promise.all([
    getUsageSummary(ctx),
    getAgency(ctx),
    listAddOns(ctx),
  ]);

  // Times are stored in UTC and shown in the agency's time zone.
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: agency.timezone }).format(d);

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <PlanBadge name={summary.planName} status={summary.status} />
          Monthly counts reset on {date(summary.period.end)}.
        </p>
      </div>

      <section aria-labelledby="monthly-heading" className="space-y-4">
        <h2 id="monthly-heading" className="text-lg font-semibold">
          This month
        </h2>
        <UsageBars lines={summary.monthly} />
      </section>

      {addOns.length > 0 ? (
        <section aria-labelledby="addons-heading" className="space-y-3">
          <h2 id="addons-heading" className="text-lg font-semibold">
            Add-ons
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Extra room added to your plan. It is already counted in the limits on this page.
          </p>
          <ul className="list-disc pl-5 text-sm">
            {addOns.map((a) => (
              <li key={a.id}>
                +{a.amount} {ADDON_LABEL[a.limitKey as AddOnKey] ?? a.limitKey}
                {a.note ? ` (${a.note})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="totals-heading" className="space-y-4">
        <h2 id="totals-heading" className="text-lg font-semibold">
          Your plan limits
        </h2>
        <UsageBars lines={summary.totals} />
      </section>
    </div>
  );
}
