import { Badge } from "@/components/ui/badge";
import type { UsageLine } from "@/server/services/usage";
import { cn } from "@/lib/utils";

function UsageBar({ line }: { line: UsageLine }) {
  const unlimited = line.limit === -1;
  const tone =
    line.percent >= 100
      ? "bg-red-600"
      : line.percent >= 80
        ? "bg-amber-500"
        : "bg-zinc-900 dark:bg-zinc-100";
  const summary = unlimited
    ? `${line.used.toLocaleString("en-US")} used (no limit)`
    : `${line.used.toLocaleString("en-US")} of ${line.limit.toLocaleString("en-US")}`;
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{line.label}</span>
        <span className="text-zinc-600 dark:text-zinc-400">
          {summary}
          {!unlimited ? ` · ${line.percent}%` : ""}
        </span>
      </div>
      {unlimited ? null : (
        <div
          role="progressbar"
          aria-label={line.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={line.percent}
          aria-valuetext={summary}
          className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        >
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${line.percent}%` }} />
        </div>
      )}
    </li>
  );
}

export function UsageBars({ lines }: { lines: UsageLine[] }) {
  return (
    <ul className="space-y-5">
      {lines.map((line) => (
        <UsageBar key={line.key} line={line} />
      ))}
    </ul>
  );
}

export function PlanBadge({ name, status }: { name: string; status: string }) {
  const trial = status === "TRIALING";
  return (
    <Badge tone={trial ? "warning" : "neutral"}>
      {name} plan{trial ? " (free trial)" : ""}
    </Badge>
  );
}
