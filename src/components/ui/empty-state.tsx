import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shown when a list or page has nothing to show yet. Say what it is and what to do next. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700",
        className,
      )}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
