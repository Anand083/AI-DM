import { BUCKETS, formatChange, formatPosition, type BucketKey } from "@/lib/rank-math";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{hint}</p> : null}
    </div>
  );
}

/** "+4" in green with an up arrow, "-2" in red with a down arrow. The text works without colour. */
export function ChangeBadge({ change }: { change: number | null }) {
  if (change === null) return <span className="text-zinc-500">-</span>;
  const label = change > 0 ? `Up ${change}` : change < 0 ? `Down ${Math.abs(change)}` : "No change";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-medium",
        change > 0 && "text-green-700 dark:text-green-400",
        change < 0 && "text-red-700 dark:text-red-400",
        change === 0 && "text-zinc-600 dark:text-zinc-400",
      )}
    >
      <span aria-hidden="true">{change > 0 ? "▲" : change < 0 ? "▼" : "•"}</span>
      <span aria-hidden="true">{formatChange(change)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PositionText({ position, checked }: { position: number | null; checked: boolean }) {
  if (!checked) return <span className="text-zinc-500">Not checked</span>;
  return <span className="font-semibold tabular-nums">{formatPosition(position)}</span>;
}

const BAR_TONES: Record<BucketKey, string> = {
  top3: "bg-green-600",
  top10: "bg-lime-600",
  top20: "bg-amber-500",
  top50: "bg-orange-500",
  top100: "bg-red-500",
  none: "bg-zinc-400",
};

/** How many keywords sit in each part of the results. A list with bars, so it reads well on phones. */
export function DistributionBars({
  counts,
  total,
}: {
  counts: Record<BucketKey, number>;
  total: number;
}) {
  return (
    <ul className="space-y-2">
      {BUCKETS.map((b) => {
        const count = counts[b.key];
        const percent = total === 0 ? 0 : Math.round((count / total) * 100);
        return (
          <li key={b.key} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span>{b.label}</span>
            <div
              className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
              aria-hidden="true"
            >
              <div
                className={cn("h-full rounded-full", BAR_TONES[b.key])}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-right tabular-nums">
              {count}
              <span className="sr-only"> keywords, {percent} percent</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
