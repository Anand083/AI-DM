import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { formatPlanPrice, planFeatureLines, yearlySavingsPercent } from "@/lib/pricing";
import { TRIAL_DAYS } from "@/server/services/agency";
import { listPublicPlans } from "@/server/services/public-plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple plans for agencies. Start with a free trial.",
};
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = await listPublicPlans();
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Simple pricing</h1>
      <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
        Start with a {TRIAL_DAYS} day free trial. No card needed. Pay yearly and save.
      </p>
      <ul className="mt-8 grid gap-6 md:grid-cols-3" aria-label="Plans">
        {plans.map((plan) => {
          const saving = yearlySavingsPercent(plan.priceMonthlyCents, plan.priceYearlyCents);
          return (
            <li
              key={plan.code}
              data-plan={plan.code}
              className="flex flex-col rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
            >
              <h2 className="text-xl font-semibold">{plan.name}</h2>
              <p className="mt-3 text-3xl font-semibold">
                <span data-testid={`${plan.code}-monthly`}>
                  {formatPlanPrice(plan.priceMonthlyCents)}
                </span>
                <span className="text-base font-normal text-zinc-600 dark:text-zinc-400">
                  {" "}
                  per month
                </span>
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                or{" "}
                <span data-testid={`${plan.code}-yearly`}>
                  {formatPlanPrice(plan.priceYearlyCents)}
                </span>{" "}
                per year{saving > 0 ? ` (save ${saving}%)` : ""}
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {planFeatureLines(plan.limits).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Link href="/signup" className={`${buttonClasses()} mt-6`}>
                Start free trial
                <span className="sr-only"> of the {plan.name} plan</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
        You can change plan or cancel at any time. Questions?{" "}
        <Link href="/contact" className="underline underline-offset-4">
          Get in touch
        </Link>
        .
      </p>
    </div>
  );
}
