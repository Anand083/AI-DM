import { sparklinePoints } from "@/lib/research";

/** A tiny line of the last 12 months of searches. */
export function Sparkline({ values }: { values: number[] }) {
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const summary = `Searches over 12 months: from ${first.toLocaleString("en-US")} to ${last.toLocaleString("en-US")} a month`;
  return (
    <svg
      role="img"
      aria-label={summary}
      width="80"
      height="24"
      viewBox="0 0 80 24"
      className="text-zinc-700 dark:text-zinc-300"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={sparklinePoints(values, 80, 24)}
      />
    </svg>
  );
}
