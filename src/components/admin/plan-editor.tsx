"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updatePlanAction } from "@/app/admin-actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { PlanLimits } from "@/lib/plan-limits";

const NUMBER_FIELDS: [keyof PlanLimits, string][] = [
  ["maxClients", "Clients"],
  ["maxProjects", "Projects"],
  ["maxKeywords", "Tracked keywords"],
  ["maxTeamMembers", "Team members"],
  ["maxClientUsers", "Client users"],
  ["auditPagesPerMonth", "Audit pages per month"],
  ["keywordResearchPerMonth", "Keyword research per month"],
  ["liveChecksPerMonth", "Live checks per month"],
  ["aiChecksPerMonth", "AI checks per month"],
  ["backlinkQueriesPerMonth", "Backlink queries per month"],
  ["leadAuditsPerMonth", "Lead audits per month"],
  ["reportSchedules", "Report schedules"],
];

export function PlanEditor({
  plan,
}: {
  plan: {
    id: string;
    code: string;
    name: string;
    priceMonthlyCents: number;
    priceYearlyCents: number;
    isPublic: boolean;
    subscribers: number;
    limits: PlanLimits;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(plan.name);
  const [monthly, setMonthly] = useState(String(plan.priceMonthlyCents / 100));
  const [yearly, setYearly] = useState(String(plan.priceYearlyCents / 100));
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(NUMBER_FIELDS.map(([k]) => [k, String(plan.limits[k])])),
  );
  const [customDomain, setCustomDomain] = useState(plan.limits.customDomain);
  const [whiteLabel, setWhiteLabel] = useState(plan.limits.whiteLabel);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await updatePlanAction({
      planId: plan.id,
      values: {
        name,
        priceMonthlyCents: Math.round(Number(monthly) * 100),
        priceYearlyCents: Math.round(Number(yearly) * 100),
        isPublic,
        limits: {
          ...Object.fromEntries(NUMBER_FIELDS.map(([k]) => [k, Number(limits[k])])),
          customDomain,
          whiteLabel,
        },
      },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast("success", `${name} saved.`);
    router.refresh();
  }

  return (
    <form
      onSubmit={save}
      className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      aria-label={`${plan.name} plan`}
      noValidate
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {plan.code}, {plan.subscribers} {plan.subscribers === 1 ? "subscriber" : "subscribers"}
        </p>
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id={`${plan.code}-name`}
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          id={`${plan.code}-monthly`}
          label="Price per month (USD)"
          type="number"
          step="0.01"
          min="0"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
        />
        <Field
          id={`${plan.code}-yearly`}
          label="Price per year (USD)"
          type="number"
          step="0.01"
          min="0"
          value={yearly}
          onChange={(e) => setYearly(e.target.value)}
        />
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Use -1 for no limit.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {NUMBER_FIELDS.map(([key, label]) => (
          <Field
            key={key}
            id={`${plan.code}-${key}`}
            label={label}
            type="number"
            min={-1}
            value={limits[key]!}
            onChange={(e) => setLimits((c) => ({ ...c, [key]: e.target.value }))}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={customDomain}
            onChange={(e) => setCustomDomain(e.target.checked)}
          />{" "}
          Own domain
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={whiteLabel}
            onChange={(e) => setWhiteLabel(e.target.checked)}
          />{" "}
          White label
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />{" "}
          Shown to customers
        </label>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving..." : `Save ${plan.name}`}
      </Button>
    </form>
  );
}
