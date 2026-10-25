import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { getEnv } from "@/env";
import { TRIAL_DAYS } from "@/server/services/agency";
import { formatPlanPrice } from "@/lib/pricing";
import { listPublicPlans } from "@/server/services/public-plans";

export const dynamic = "force-dynamic";

const POINTS = [
  {
    title: "Know where you rank",
    text: "Check Google rankings every day for every keyword. See who moved up or down and get an alert when it matters.",
  },
  {
    title: "Fix what holds sites back",
    text: "Run a full site audit. Every problem comes with a plain explanation and what to do about it.",
  },
  {
    title: "Reports under your name",
    text: "Send clean PDF reports with your logo and colors. Set them to go out every week or every month.",
  },
] as const;

export default async function Home() {
  const appName = getEnv().APP_NAME;
  const plans = await listPublicPlans();
  const cheapest = plans[0];
  return (
    <>
      <section className="mx-auto max-w-5xl px-4 py-16 text-center sm:py-24">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          SEO tools and branded reports for your agency
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
          {appName} helps you track rankings, check websites and show clients real results, all
          under your own name.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className={buttonClasses()}>
            Start your {TRIAL_DAYS} day free trial
          </Link>
          <Link href="/features" className={buttonClasses("outline")}>
            See what you get
          </Link>
        </div>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No card needed to start.</p>
      </section>

      <section aria-labelledby="points-h" className="mx-auto max-w-5xl px-4 pb-16">
        <h2 id="points-h" className="sr-only">
          What it does
        </h2>
        <ul className="grid gap-6 md:grid-cols-3">
          {POINTS.map((p) => (
            <li
              key={p.title}
              className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
            >
              <h3 className="text-lg font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="clients-h" className="bg-zinc-50 py-14 dark:bg-zinc-900">
        <div className="mx-auto max-w-5xl px-4">
          <h2 id="clients-h" className="text-2xl font-semibold">
            Your clients see your brand, not ours
          </h2>
          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Give each client their own login to a page with your logo and colors. They can read
            their rankings, see how their website is doing and download their reports.
          </p>
        </div>
      </section>

      {cheapest ? (
        <section aria-labelledby="price-h" className="mx-auto max-w-5xl px-4 py-14 text-center">
          <h2 id="price-h" className="text-2xl font-semibold">
            Plans from {formatPlanPrice(cheapest.priceMonthlyCents)} a month
          </h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Every plan starts with a free trial. Change or cancel at any time.
          </p>
          <Link href="/pricing" className={`${buttonClasses("outline")} mt-5`}>
            See all plans
          </Link>
        </section>
      ) : null}
    </>
  );
}
