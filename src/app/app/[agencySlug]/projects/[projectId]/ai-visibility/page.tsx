import type { Metadata } from "next";
import { AiSetupPanel } from "@/components/app/ai-setup-panel";
import { StatCard } from "@/components/app/rank-widgets";
import { RunAiCheckButton } from "@/components/app/run-ai-check-button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { engineLabel, MAX_AI_PROMPTS, sortByEngine } from "@/lib/ai-visibility";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import {
  getAiOverview,
  getAiSettings,
  listLatestAnswers,
  listPrompts,
} from "@/server/services/ai-visibility";

export const metadata: Metadata = { title: "AI visibility" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const dayText = (d: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  );

export default async function AiVisibilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const page = pageFromParams(sp.page);
  const [settings, prompts, overview, answers] = await Promise.all([
    getAiSettings(ctx, projectId),
    listPrompts(ctx, projectId),
    getAiOverview(ctx, projectId),
    listLatestAnswers(ctx, projectId, { page, pageSize: PAGE_SIZE }),
  ]);
  const base = `/app/${agencySlug}/projects/${projectId}/ai-visibility`;
  const canEdit = can(ctx.role, "content.edit");
  const canRun = can(ctx.role, "tools.run");
  const { latest } = overview;
  const rateChange =
    overview.previousRate === null || !latest ? null : latest.mentionRate - overview.previousRate;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI visibility</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Do AI assistants like ChatGPT name this brand when people ask about its field? We ask
            your questions once a week.
            {overview.latestOn ? ` Last checked ${dayText(overview.latestOn)}.` : ""}
          </p>
        </div>
        {canRun && prompts.length > 0 ? (
          <RunAiCheckButton
            agencySlug={agencySlug}
            projectId={projectId}
            label={overview.latestOn ? "Check again" : "Run first check"}
            checkedToday={overview.checkedToday}
          />
        ) : null}
      </div>

      <AiSetupPanel
        key={`${settings.brandName}|${settings.engines.join(",")}|${prompts.map((p) => p.id).join(",")}`}
        agencySlug={agencySlug}
        projectId={projectId}
        prompts={prompts}
        maxPrompts={MAX_AI_PROMPTS}
        brandName={settings.brandName}
        engines={settings.engines}
        canEdit={canEdit}
      />

      {!latest ? (
        <EmptyState
          title="No AI results yet"
          description={
            prompts.length === 0
              ? "Add a question above, then run the first check."
              : "Run the first check to see how AI assistants answer."
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Brand mentioned"
              value={`${latest.mentionRate}%`}
              hint={`${latest.mentioned} of ${latest.total} answers${rateChange === null ? "" : rateChange === 0 ? ", same as the check before" : `, ${rateChange > 0 ? "up" : "down"} ${Math.abs(rateChange)} points since the check before`}`}
            />
            <StatCard
              label="Website linked"
              value={`${latest.citedRate}%`}
              hint={`${latest.cited} of ${latest.total} answers link to the site`}
            />
            <StatCard
              label="Share of voice"
              value={latest.shareOfVoice === null ? "-" : `${latest.shareOfVoice}%`}
              hint="The brand against your competitors in the same answers"
            />
            <StatCard
              label="Average place in the answer"
              value={latest.averagePosition === null ? "-" : String(latest.averagePosition)}
              hint="1 means named first"
            />
          </div>

          <section aria-labelledby="engines-heading" className="space-y-2">
            <h3 id="engines-heading" className="text-base font-semibold">
              By AI engine
            </h3>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm" aria-label="By AI engine">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    {["Engine", "Answers", "Brand named", "Rate"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortByEngine(Object.entries(latest.byEngine)).map(([engine, e]) => (
                    <tr
                      key={engine}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                    >
                      <td className="px-4 py-2 font-medium">{engineLabel(engine)}</td>
                      <td className="px-4 py-2 tabular-nums">{e.total}</td>
                      <td className="px-4 py-2 tabular-nums">{e.mentioned}</td>
                      <td className="px-4 py-2 tabular-nums">{e.mentionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {Object.keys(latest.competitorMentions).length > 0 ? (
            <section aria-labelledby="rivals-heading" className="space-y-2">
              <h3 id="rivals-heading" className="text-base font-semibold">
                Competitors named in the answers
              </h3>
              <ul className="flex flex-wrap gap-2">
                {Object.entries(latest.competitorMentions)
                  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                  .map(([domain, count]) => (
                    <li key={domain}>
                      <Badge>
                        {domain}: {count}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

          {overview.history.length > 1 ? (
            <section aria-labelledby="trend-heading" className="space-y-2">
              <h3 id="trend-heading" className="text-base font-semibold">
                Mention rate over time
              </h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm" aria-label="Mention rate over time">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      {["Checked", "Answers", "Brand named", "Rate"].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overview.history.map((h) => (
                      <tr
                        key={h.date}
                        className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                      >
                        <td className="px-4 py-2">{dayText(h.date)}</td>
                        <td className="px-4 py-2 tabular-nums">{h.total}</td>
                        <td className="px-4 py-2 tabular-nums">{h.mentioned}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="inline-block h-2 rounded bg-zinc-700 dark:bg-zinc-300"
                              style={{ width: `${Math.max(2, h.mentionRate)}px` }}
                            />
                            <span className="tabular-nums">{h.mentionRate}%</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {overview.citedPages.length > 0 ? (
            <section aria-labelledby="cited-heading" className="space-y-2">
              <h3 id="cited-heading" className="text-base font-semibold">
                Pages the AI engines link to
              </h3>
              <ul aria-label="Cited pages" className="space-y-1 text-sm">
                {overview.citedPages.map((c) => (
                  <li key={c.url} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{c.url}</span>
                    <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-400">
                      {c.count} {c.count === 1 ? "answer" : "answers"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="answers-heading" className="space-y-3">
            <h3 id="answers-heading" className="text-base font-semibold">
              Latest answers
            </h3>
            <div
              role="region"
              aria-label="Latest answers list"
              tabIndex={0}
              className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <table className="w-full text-left text-sm" aria-label="Latest answers">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    {["Question", "Engine", "Brand named", "Place", "Mood", "Answer"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {answers.rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900"
                    >
                      <td className="max-w-[14rem] px-4 py-2">{r.prompt.text}</td>
                      <td className="whitespace-nowrap px-4 py-2">{engineLabel(r.engine)}</td>
                      <td className="px-4 py-2">
                        <Badge tone={r.brandMentioned ? "success" : "neutral"}>
                          {r.brandMentioned ? "Yes" : "No"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{r.mentionPosition ?? "-"}</td>
                      <td className="px-4 py-2">{r.sentiment ?? "-"}</td>
                      <td className="min-w-[16rem] px-4 py-2 text-zinc-700 dark:text-zinc-300">
                        {r.snippet}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath={base}
              page={page}
              pageSize={PAGE_SIZE}
              total={answers.total}
              label="Answer pages"
            />
          </section>
        </>
      )}
    </div>
  );
}
