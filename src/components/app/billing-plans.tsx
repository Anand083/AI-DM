"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  cancelSubscriptionAction,
  changePlanAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from "@/app/app/[agencySlug]/billing/actions";
import { FormMessage } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { Interval, SubStatus } from "@/lib/billing-state";
import { UNLIMITED } from "@/lib/plan-limits";

export type PlanCard = {
  code: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  limits: {
    maxClients: number;
    maxProjects: number;
    maxKeywords: number;
    maxTeamMembers: number;
    maxClientUsers: number;
    customDomain: boolean;
  };
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const limit = (n: number, one: string, many: string) =>
  n === UNLIMITED ? `Unlimited ${many}` : `${n} ${n === 1 ? one : many}`;

export function BillingPlans({
  agencySlug,
  plans,
  status,
  currentCode,
  currentInterval,
  pendingCode,
  cancelAtPeriodEnd,
}: {
  agencySlug: string;
  plans: PlanCard[];
  status: SubStatus;
  currentCode: string;
  currentInterval: Interval;
  pendingCode: string | null;
  cancelAtPeriodEnd: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [interval, setInterval] = useState<Interval>(currentInterval);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = status === "ACTIVE";
  const current = plans.find((p) => p.code === currentCode);

  async function choose(plan: PlanCard) {
    setBusy(plan.code);
    setError(null);
    if (!active) {
      const result = await startCheckoutAction(agencySlug, { planCode: plan.code, interval });
      if (!result.ok) {
        setBusy(null);
        return setError(result.error);
      }
      window.location.assign(result.data.url);
      return;
    }
    const result = await changePlanAction(agencySlug, { planCode: plan.code, interval });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    toast(
      "success",
      result.data.scheduled
        ? "Your plan will change at the end of this billing period."
        : "Your plan was changed.",
    );
    router.refresh();
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    setBusy("action");
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) return setError(result.error ?? "Something went wrong.");
    toast("success", message);
    router.refresh();
  }

  function label(plan: PlanCard): string {
    if (!active) return `Choose ${plan.name}`;
    if (plan.code === currentCode && interval === currentInterval) return "Current plan";
    if (plan.code === pendingCode) return "Planned";
    if (current && plan.priceMonthlyCents > current.priceMonthlyCents)
      return `Upgrade to ${plan.name}`;
    return `Switch to ${plan.name}`;
  }

  return (
    <section aria-labelledby="plans-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="plans-heading" className="text-lg font-semibold">
          Plans
        </h2>
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700"
        >
          {(["MONTH", "YEAR"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={`rounded px-3 py-1.5 text-sm ${interval === i ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
            >
              {i === "MONTH" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <ul className="grid gap-4 md:grid-cols-3" aria-label="Plans">
        {plans.map((plan) => {
          const isCurrent = active && plan.code === currentCode && interval === currentInterval;
          const price = interval === "YEAR" ? plan.priceYearlyCents : plan.priceMonthlyCents;
          return (
            <li
              key={plan.code}
              className="flex flex-col rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{plan.name}</h3>
                {plan.code === currentCode && status !== "EXPIRED" && status !== "CANCELED" ? (
                  <Badge tone="success">Your plan</Badge>
                ) : null}
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {money(price)}
                <span className="text-sm font-normal text-zinc-600 dark:text-zinc-400">
                  {interval === "YEAR" ? " per year" : " per month"}
                </span>
              </p>
              <ul className="mt-3 flex-1 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                <li>{limit(plan.limits.maxClients, "client", "clients")}</li>
                <li>{limit(plan.limits.maxProjects, "project", "projects")}</li>
                <li>{limit(plan.limits.maxKeywords, "keyword", "keywords")}</li>
                <li>{limit(plan.limits.maxTeamMembers, "team member", "team members")}</li>
                <li>{limit(plan.limits.maxClientUsers, "client login", "client logins")}</li>
                {plan.limits.customDomain ? <li>Your own domain</li> : null}
              </ul>
              <Button
                type="button"
                className="mt-4 w-full"
                variant={isCurrent ? "outline" : "primary"}
                disabled={busy !== null || isCurrent}
                onClick={() => choose(plan)}
                aria-label={`${label(plan)}, ${interval === "YEAR" ? "yearly" : "monthly"}`}
              >
                {busy === plan.code ? "Please wait..." : label(plan)}
              </Button>
            </li>
          );
        })}
      </ul>

      {active || status === "PAST_DUE" ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {cancelAtPeriodEnd ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run(() => resumeSubscriptionAction(agencySlug), "Your subscription will continue.")
              }
            >
              Keep my subscription
            </Button>
          ) : (
            <ConfirmDialog
              trigger="Cancel subscription"
              title="Cancel your subscription?"
              description="You keep everything until the end of the period you paid for. After that your account becomes read-only. Nothing is deleted."
              confirmLabel="Cancel subscription"
              onConfirm={async () => {
                const result = await cancelSubscriptionAction(agencySlug);
                if (!result.ok) return result.error;
                toast("success", "Your subscription will end at the end of this billing period.");
                router.refresh();
                return null;
              }}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}
