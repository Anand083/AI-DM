import { Check } from "lucide-react";
import Link from "next/link";
import type { OnboardingState } from "@/server/services/onboarding";

/** The "get started" card on the dashboard. It goes away once every step is done. */
export function OnboardingChecklist({
  state,
  helpHref,
}: {
  state: OnboardingState;
  helpHref: string;
}) {
  if (state.complete) return null;
  const percent = Math.round((state.done / state.total) * 100);
  return (
    <section
      aria-labelledby="start-h"
      className="space-y-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="start-h" className="text-lg font-semibold">
          Get started
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="checklist-progress">
          {state.done} of {state.total} done
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${state.done} of ${state.total} steps done`}
        className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div className="h-full bg-green-600" style={{ width: `${percent}%` }} />
      </div>
      <ol className="space-y-2" aria-label="Setup steps">
        {state.items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 text-sm" data-done={item.done}>
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                item.done
                  ? "border-green-700 bg-green-700 text-white"
                  : "border-zinc-400 dark:border-zinc-600"
              }`}
            >
              {item.done ? <Check className="size-3.5" /> : null}
            </span>
            <span>
              {item.done ? (
                <span className="text-zinc-600 line-through dark:text-zinc-400">
                  {item.label}
                  <span className="sr-only"> (done)</span>
                </span>
              ) : (
                <Link href={item.href} className="font-medium underline underline-offset-4">
                  {item.label}
                </Link>
              )}
              {item.done ? null : (
                <span className="block text-zinc-600 dark:text-zinc-400">{item.hint}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Need a hand?{" "}
        <Link href={helpHref} className="underline underline-offset-4">
          Read the help guides
        </Link>
        .
      </p>
    </section>
  );
}
