import { Badge } from "@/components/ui/badge";
import { METHOD_NOTE } from "@/lib/ai-insights";
import { engineLabel } from "@/lib/ai-visibility";
import type { getAiInsights } from "@/server/services/ai-insights";

type Insights = Awaited<ReturnType<typeof getAiInsights>>;

const head = "border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";
const rowCls = "border-b border-zinc-100 last:border-0 dark:border-zinc-900";
const box = "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const TONE = { high: "success", medium: "neutral", low: "neutral" } as const;

function Table({
  label,
  columns,
  children,
}: {
  label: string;
  columns: string[];
  children: React.ReactNode;
}) {
  return (
    <div className={box}>
      <table className="w-full text-left text-sm" aria-label={label}>
        <thead className={head}>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-4 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const arrow = (change: number | null) =>
  change === null
    ? "-"
    : change === 0
      ? "no change"
      : `${change > 0 ? "up" : "down"} ${Math.abs(change)} points`;

/** Coverage, freshness, method and advice. Shown above the numbers. */
export function AiCoverageBanner({ insights }: { insights: Insights }) {
  const c = insights.coverage;
  return (
    <div
      className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
      role="note"
      aria-label="Data coverage"
    >
      <p>
        <span className="font-medium">Coverage:</span> {c.label}.
      </p>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">{METHOD_NOTE}</p>
    </div>
  );
}

export function AiInsightsPanels({ insights }: { insights: Insights }) {
  const { comparison, citations, engineTrends, promptTrends, market, recommendations } = insights;
  return (
    <div className="space-y-8">
      {recommendations.length > 0 ? (
        <section aria-labelledby="recs-heading" className="space-y-2">
          <h3 id="recs-heading" className="text-base font-semibold">
            What to do next
          </h3>
          <ul aria-label="Recommendations" className="space-y-3">
            {recommendations.map((r) => (
              <li key={r.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <Badge tone={TONE[r.confidence]}>Confidence: {r.confidence}</Badge>
                </div>
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium">Why:</span> {r.evidence}
                </p>
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium">Try:</span> {r.action}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {comparison.total > 0 && comparison.rivals.length > 0 ? (
        <section aria-labelledby="compare-heading" className="space-y-2">
          <h3 id="compare-heading" className="text-base font-semibold">
            You against your competitors
          </h3>
          <Table
            label="Competitor comparison"
            columns={["Website", "Answers naming it", "Share of answers"]}
          >
            <tr className={`${rowCls} font-medium`}>
              <td className="px-4 py-2">Your brand</td>
              <td className="px-4 py-2 tabular-nums">{comparison.brand.answers}</td>
              <td className="px-4 py-2 tabular-nums">{comparison.brand.rate}%</td>
            </tr>
            {comparison.rivals.map((r) => (
              <tr key={r.domain} className={rowCls}>
                <td className="px-4 py-2">{r.domain}</td>
                <td className="px-4 py-2 tabular-nums">{r.answers}</td>
                <td className="px-4 py-2 tabular-nums">{r.rate}%</td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Out of {comparison.total} answers in the latest check.
          </p>
        </section>
      ) : null}

      {citations.length > 0 ? (
        <section aria-labelledby="sources-heading" className="space-y-2">
          <h3 id="sources-heading" className="text-base font-semibold">
            Websites AI links to
          </h3>
          <Table label="Cited websites" columns={["Website", "Links", "Share", "Who"]}>
            {citations.map((c) => (
              <tr key={c.domain} className={rowCls}>
                <td className="px-4 py-2">{c.domain}</td>
                <td className="px-4 py-2 tabular-nums">{c.count}</td>
                <td className="px-4 py-2 tabular-nums">{c.share}%</td>
                <td className="px-4 py-2">
                  {c.kind === "you" ? (
                    <Badge tone="success">Your site</Badge>
                  ) : c.kind === "competitor" ? (
                    <Badge>Competitor</Badge>
                  ) : (
                    "Other"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      {engineTrends.some((t) => t.points.length > 1) ? (
        <section aria-labelledby="engine-trend-heading" className="space-y-2">
          <h3 id="engine-trend-heading" className="text-base font-semibold">
            Trend by AI engine
          </h3>
          <Table
            label="Trend by engine"
            columns={["Engine", "Mention rate by check, oldest first", "Change"]}
          >
            {engineTrends.map((t) => (
              <tr key={t.key} className={rowCls}>
                <td className="px-4 py-2 font-medium">{engineLabel(t.key)}</td>
                <td className="px-4 py-2 tabular-nums">
                  {t.points.map((p) => `${p.rate}%`).join(", ")}
                </td>
                <td className="px-4 py-2">{arrow(t.change)}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      {promptTrends.some((t) => t.points.length > 1) ? (
        <section aria-labelledby="prompt-trend-heading" className="space-y-2">
          <h3 id="prompt-trend-heading" className="text-base font-semibold">
            Trend by question
          </h3>
          <Table
            label="Trend by question"
            columns={["Question", "Mention rate by check, oldest first", "Change"]}
          >
            {promptTrends.map((t) => (
              <tr key={t.key} className={rowCls}>
                <td className="px-4 py-2">{t.key}</td>
                <td className="px-4 py-2 tabular-nums">
                  {t.points.map((p) => `${p.rate}%`).join(", ")}
                </td>
                <td className="px-4 py-2">{arrow(t.change)}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      {market ? (
        <section aria-labelledby="market-heading" className="space-y-3">
          <h3 id="market-heading" className="text-base font-semibold">
            Market view
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            From {market.takenOn}, {market.sample ? "sample data" : "real data"}. These are vendor
            estimates of how much people ask AI assistants, not exact counts.
          </p>
          <Table
            label="AI topic demand"
            columns={["Topic", "AI searches a month", "Change in 3 months"]}
          >
            {market.topics.map((t) => (
              <tr key={t.topic} className={rowCls}>
                <td className="px-4 py-2">{t.topic}</td>
                <td className="px-4 py-2 tabular-nums">
                  {t.aiSearchVolume.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {t.changePercent >= 0 ? "+" : ""}
                  {t.changePercent}%
                </td>
              </tr>
            ))}
          </Table>
          <Table
            label="Mentions of your site by AI"
            columns={["Engine", "Answers naming the site", "Top question"]}
          >
            {market.mentions.map((m) => (
              <tr key={m.engine} className={rowCls}>
                <td className="px-4 py-2 font-medium">{engineLabel(m.engine)}</td>
                <td className="px-4 py-2 tabular-nums">{m.mentions.toLocaleString("en-US")}</td>
                <td className="px-4 py-2">{m.topQuestions[0]?.question ?? "-"}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}
    </div>
  );
}
