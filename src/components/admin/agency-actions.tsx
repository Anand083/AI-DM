"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addBonusAction,
  changeAgencyPlanAction,
  extendTrialAction,
  setSuspendedAction,
  startSupportSessionAction,
} from "@/app/admin-actions";
import { AdminButton } from "@/components/admin/admin-button";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

const METRICS = [
  ["LIVE_CHECK", "Live rank checks"],
  ["AUDIT_PAGE", "Audit pages"],
  ["KEYWORD_RESEARCH", "Keyword research searches"],
  ["BACKLINK_QUERY", "Backlink queries"],
  ["AI_CHECK", "AI checks"],
  ["LEAD_AUDIT", "Lead audits"],
] as const;

export function AgencyActions({
  agencyId,
  suspended,
  canExtendTrial,
  planCode,
  plans,
  owners,
}: {
  agencyId: string;
  suspended: boolean;
  canExtendTrial: boolean;
  planCode: string | null;
  plans: { code: string; name: string }[];
  owners: { userId: string; label: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [plan, setPlan] = useState(planCode ?? plans[0]?.code ?? "");
  const [days, setDays] = useState("14");
  const [metric, setMetric] = useState<(typeof METRICS)[number][0]>("LIVE_CHECK");
  const [quantity, setQuantity] = useState("100");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState(owners[0]?.userId ?? "");
  const [error, setError] = useState<string | null>(null);

  async function addBonus(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await addBonusAction({
      agencyId,
      bonus: { metric, quantity: Number(quantity), note: note || undefined },
    });
    if (!result.ok) return setError(result.error);
    toast("success", "Bonus added for this month.");
    router.refresh();
  }

  return (
    <section aria-labelledby="actions-h" className="space-y-5">
      <h2 id="actions-h" className="text-lg font-semibold">
        Actions
      </h2>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <div className="flex flex-wrap items-end gap-3">
        {owners.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="view-as">View as</Label>
            <Select id="view-as" value={target} onChange={(e) => setTarget(e.target.value)}>
              {owners.map((o) => (
                <option key={o.userId} value={o.userId}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <AdminButton
          label="View as this agency"
          variant="primary"
          run={() => startSupportSessionAction({ agencyId, userId: target || undefined })}
          onDone={(data) => {
            router.push(`/app/${(data as { slug: string }).slug}`);
          }}
        />
        <AdminButton
          label={suspended ? "Unsuspend" : "Suspend"}
          run={() => setSuspendedAction({ agencyId, suspended: !suspended })}
          success={suspended ? "Agency unsuspended." : "Agency suspended."}
          confirm={
            suspended
              ? undefined
              : {
                  title: "Suspend this agency?",
                  description:
                    "Their team will see a suspended page and cannot use the app. Nothing is deleted.",
                }
          }
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="plan-code">Plan</Label>
          <Select id="plan-code" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <AdminButton
          label="Change plan"
          run={() => changeAgencyPlanAction({ agencyId, planCode: plan })}
          success="Plan changed. Nothing was charged."
        />
      </div>

      {canExtendTrial ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            id="trial-days"
            label="Extend trial by (days)"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-32"
          />
          <AdminButton
            label="Extend trial"
            run={() => extendTrialAction({ agencyId, days: Number(days) })}
            success="Trial extended."
          />
        </div>
      ) : null}

      <form
        onSubmit={addBonus}
        className="flex flex-wrap items-end gap-3"
        aria-label="Add bonus usage"
      >
        <div className="space-y-1.5">
          <Label htmlFor="bonus-metric">Bonus usage</Label>
          <Select
            id="bonus-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as typeof metric)}
          >
            {METRICS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Field
          id="bonus-quantity"
          label="How many"
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-28"
        />
        <Field
          id="bonus-note"
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
        <Button type="submit" variant="outline" className="h-10">
          Add bonus
        </Button>
      </form>
    </section>
  );
}
