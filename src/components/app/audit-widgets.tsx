import { scoreBand } from "@/lib/audit-math";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const BAND_TEXT = { good: "Good", fair: "Needs work", poor: "Poor" } as const;
const BAND_RING = {
  good: "border-green-600 text-green-800 dark:text-green-300",
  fair: "border-amber-500 text-amber-800 dark:text-amber-300",
  poor: "border-red-600 text-red-800 dark:text-red-300",
} as const;

/** The health score as a number in a ring, with a word so it never relies on colour. */
export function ScoreBadge({ score, size = "lg" }: { score: number; size?: "sm" | "lg" }) {
  const band = scoreBand(score);
  return (
    <div className="inline-flex items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center rounded-full border-4 font-semibold tabular-nums",
          BAND_RING[band],
          size === "lg" ? "size-20 text-2xl" : "size-12 text-base",
        )}
      >
        <span aria-label={`Health score ${score} out of 100`}>{score}</span>
      </div>
      <span className="text-sm font-medium">{BAND_TEXT[band]}</span>
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: "CRITICAL" | "WARNING" | "NOTICE" }) {
  const tone = severity === "CRITICAL" ? "danger" : severity === "WARNING" ? "warning" : "neutral";
  const label =
    severity === "CRITICAL" ? "Critical" : severity === "WARNING" ? "Warning" : "Notice";
  return <Badge tone={tone}>{label}</Badge>;
}

export function AuditStatusBadge({
  status,
}: {
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
}) {
  const map = {
    QUEUED: ["Waiting to start", "neutral"],
    RUNNING: ["Running", "warning"],
    COMPLETED: ["Done", "success"],
    FAILED: ["Failed", "danger"],
  } as const;
  const [label, tone] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
