import { AddSuggestedCompetitorButton } from "@/components/app/add-suggested-competitor-button";
import { RefreshCompetitorLinksButton } from "@/components/app/refresh-competitor-links-button";
import { Badge } from "@/components/ui/badge";
import type { CompetitorInsights } from "@/server/services/competitor-insights";

const head = "border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";
const rowCls = "border-b border-zinc-100 last:border-0 dark:border-zinc-900";
const box = "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const num = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-US"));

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
    <div role="region" aria-label={`${label} table`} tabIndex={0} className={box}>
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

export function CompetitorInsightsPanels({
  insights,
  agencySlug,
  projectId,
  canEdit,
  canRun,
  hasCompetitors,
}: {
  insights: CompetitorInsights;
  agencySlug: string;
  projectId: string;
  canEdit: boolean;
  canRun: boolean;
  hasCompetitors: boolean;
}) {
  const { suggestions, history, links } = insights;
  const today = new Date().toISOString().slice(0, 10);
  const weeks = history.weeks.filter((w) => w.keywords > 0);
  return (
    <div className="space-y-8">
      {suggestions.length > 0 ? (
        <section aria-labelledby="suggest-heading" className="space-y-2">
          <h3 id="suggest-heading" className="text-base font-semibold">
            Websites that keep showing up
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            These websites are in the top 10 for several of your keywords and you do not track them
            yet. Big general sites such as Wikipedia are left out.
          </p>
          <Table
            label="Suggested competitors"
            columns={["Website", "Keywords in top 10", "Share", "Average position", ""]}
          >
            {suggestions.map((s) => (
              <tr key={s.domain} className={rowCls}>
                <td className="px-4 py-2 font-medium">{s.domain}</td>
                <td className="px-4 py-2 tabular-nums">{s.keywords}</td>
                <td className="px-4 py-2 tabular-nums">{s.share}%</td>
                <td className="px-4 py-2 tabular-nums">{s.averagePosition}</td>
                <td className="px-4 py-2">
                  {canEdit ? (
                    <AddSuggestedCompetitorButton
                      agencySlug={agencySlug}
                      projectId={projectId}
                      domain={s.domain}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      {weeks.length > 1 ? (
        <section aria-labelledby="history-heading" className="space-y-2">
          <h3 id="history-heading" className="text-base font-semibold">
            Top 10 places by week
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            How many of your keywords each website holds in the top 10, from the saved rank checks.
          </p>
          <Table
            label="Competitor movement by week"
            columns={[
              "Week ending",
              ...[history.own, ...history.domains].map((d) =>
                d === history.own ? `${d} (you)` : d,
              ),
            ]}
          >
            {[...weeks].reverse().map((w) => (
              <tr key={w.weekEnd} className={rowCls}>
                <td className="px-4 py-2">{w.weekEnd}</td>
                {[history.own, ...history.domains].map((d) => (
                  <td key={d} className="px-4 py-2 tabular-nums">
                    {w.byDomain[d]?.top10 ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      {hasCompetitors ? (
        <section aria-labelledby="links-heading" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="links-heading" className="text-base font-semibold">
                Links compared
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {links.fetchedOn
                  ? `Competitor links read on ${links.fetchedOn}.`
                  : "Competitor links have not been read yet."}
              </p>
            </div>
            {canRun ? (
              <RefreshCompetitorLinksButton
                agencySlug={agencySlug}
                projectId={projectId}
                label={links.fetchedOn ? "Refresh competitor links" : "Read competitor links"}
                doneToday={links.fetchedOn === today}
              />
            ) : null}
          </div>
          <Table
            label="Link comparison"
            columns={["Website", "Links", "Linking websites", "Rating (0 to 100)"]}
          >
            {links.rows.map((r) => (
              <tr key={r.domain} className={rowCls}>
                <td className="px-4 py-2 font-medium">
                  {r.domain} {r.isYou ? <Badge tone="success">You</Badge> : null}
                </td>
                <td className="px-4 py-2 tabular-nums">{num(r.backlinks)}</td>
                <td className="px-4 py-2 tabular-nums">{num(r.referringDomains)}</td>
                <td className="px-4 py-2 tabular-nums">{num(r.rating)}</td>
              </tr>
            ))}
          </Table>
          {links.gap.length > 0 ? (
            <>
              <h4 className="text-sm font-semibold">
                Websites that link to your competitors but not to you
              </h4>
              <Table label="Link gap" columns={["Website", "Rating", "Links to"]}>
                {links.gap.slice(0, 25).map((g) => (
                  <tr key={g.sourceDomain} className={rowCls}>
                    <td className="px-4 py-2">{g.sourceDomain}</td>
                    <td className="px-4 py-2 tabular-nums">{g.rating}</td>
                    <td className="px-4 py-2">{g.competitors.join(", ")}</td>
                  </tr>
                ))}
              </Table>
            </>
          ) : links.fetchedOn ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No gap found: every website that links to a competitor also links to you.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
