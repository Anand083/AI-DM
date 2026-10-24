import type { Metadata } from "next";
import { PlanBadge, UsageBars } from "@/components/app/usage-bars";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";
import { getUsageSummary } from "@/server/services/usage";

export const metadata: Metadata = { title: "Usage" };
export const dynamic = "force-dynamic";

export default async function UsagePage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "branding.edit");
  const [summary, agency] = await Promise.all([getUsageSummary(ctx), getAgency(ctx)]);

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

      <section aria-labelledby="totals-heading" className="space-y-4">
        <h2 id="totals-heading" className="text-lg font-semibold">
          Your plan limits
        </h2>
        <UsageBars lines={summary.totals} />
      </section>
    </div>
  );
}
