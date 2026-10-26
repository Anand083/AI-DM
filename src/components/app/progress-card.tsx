import { progressSentence, type Progress } from "@/lib/progress";

const TONE = {
  better: "border-green-600",
  worse: "border-red-600",
  same: "border-zinc-300 dark:border-zinc-700",
  none: "border-zinc-300 dark:border-zinc-700",
} as const;

const TITLE = {
  better: "Rankings are better than at the start",
  worse: "Rankings are worse than at the start",
  same: "Rankings are about the same as at the start",
  none: "Progress since tracking started",
} as const;

/** The answer to "did this client go up or down since we started?" in plain words. */
export function ProgressCard({ progress, title }: { progress: Progress; title?: string }) {
  const p = progress;
  return (
    <section
      aria-label={title ?? "Progress since tracking started"}
      className={`space-y-3 rounded-lg border-l-4 border p-4 ${TONE[p.verdict]}`}
    >
      <div>
        <h2 className="text-lg font-semibold">{title ?? TITLE[p.verdict]}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {progressSentence(p)}
          {p.since ? ` Tracking since ${p.since}.` : ""}
        </p>
      </div>
      {p.compared > 0 ? (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-600 dark:text-zinc-400">Keywords up</dt>
            <dd className="text-xl font-semibold">{p.up}</dd>
          </div>
          <div>
            <dt className="text-zinc-600 dark:text-zinc-400">Keywords down</dt>
            <dd className="text-xl font-semibold">{p.down}</dd>
          </div>
          <div>
            <dt className="text-zinc-600 dark:text-zinc-400">On page one</dt>
            <dd className="text-xl font-semibold">
              {p.pageOneStart} to {p.pageOneNow}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-600 dark:text-zinc-400">Visibility score</dt>
            <dd className="text-xl font-semibold">
              {p.visibilityStart} to {p.visibilityNow}
            </dd>
          </div>
        </dl>
      ) : null}
      {p.waiting > 0 && p.compared > 0 ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {p.waiting} newer {p.waiting === 1 ? "keyword is" : "keywords are"} not counted yet.
        </p>
      ) : null}
    </section>
  );
}
