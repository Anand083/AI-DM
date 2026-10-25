import type { Metadata } from "next";
import { PlanEditor } from "@/components/admin/plan-editor";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listPlansForAdmin } from "@/server/admin/plans";

export const metadata: Metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function AdminPlans() {
  const admin = await requireSuperAdmin();
  const plans = await listPlansForAdmin(admin);
  return (
    <>
      <h1 className="text-2xl font-semibold">Plans</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Changes apply to everyone on the plan straight away. Prices change for new payments only.
      </p>
      {plans.map((p) => (
        <PlanEditor
          key={p.id}
          plan={{
            id: p.id,
            code: p.code,
            name: p.name,
            priceMonthlyCents: p.priceMonthlyCents,
            priceYearlyCents: p.priceYearlyCents,
            isPublic: p.isPublic,
            subscribers: p._count.subscriptions,
            limits: p.limits,
          }}
        />
      ))}
    </>
  );
}
