import type { Metadata } from "next";
import { BudgetForm, FlagToggle, MaintenanceToggle } from "@/components/admin/settings-forms";
import { Badge } from "@/components/ui/badge";
import { getEnv } from "@/env";
import { requireSuperAdmin } from "@/server/admin/guard";
import { getPlatformSettings } from "@/server/admin/settings";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettings() {
  const admin = await requireSuperAdmin();
  const settings = await getPlatformSettings(admin, getEnv().MONTHLY_PROVIDER_BUDGET_USD);
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section aria-labelledby="budget-h" className="space-y-2">
        <h2 id="budget-h" className="text-lg font-semibold">
          Provider budget
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          At 80% you get an email. At 100% scheduled jobs and new data requests pause. 0 turns the
          guard off.
        </p>
        <BudgetForm budgetUsd={settings.budgetUsd} />
      </section>

      <section aria-labelledby="maint-h" className="space-y-2">
        <h2 id="maint-h" className="flex items-center gap-3 text-lg font-semibold">
          Maintenance mode
          <Badge tone={settings.maintenance ? "warning" : "success"}>
            {settings.maintenance ? "on" : "off"}
          </Badge>
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          When on, the agency app shows a maintenance message to everyone. This admin area keeps
          working.
        </p>
        <MaintenanceToggle on={settings.maintenance} />
      </section>

      <section aria-labelledby="flags-h" className="space-y-2">
        <h2 id="flags-h" className="text-lg font-semibold">
          Features
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Switch a feature off for everyone. New features are added here as they are built.
        </p>
        <div className="space-y-2">
          {settings.flags.map((f) => (
            <FlagToggle key={f.key} flagKey={f.key} label={f.label} enabled={f.enabled} />
          ))}
        </div>
      </section>
    </>
  );
}
