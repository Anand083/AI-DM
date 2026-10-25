import { brandCssVars, initials } from "@/lib/brand";
import { formatChange, formatPosition } from "@/lib/rank-math";
import { describeAnalytics } from "@/lib/report-analytics";
import {
  KIND_LABELS,
  describeComparison,
  describeCompetitorLinks,
  describeSource,
} from "@/lib/report-extras";
import { describeReviews } from "@/lib/report-reviews";
import { describeAi } from "@/lib/report-ai";
import { describeBacklinks } from "@/lib/report-backlinks";
import type { ReportBacklinkRow, ReportKeywordRow, ReportModel } from "@/lib/report-model";

export type ReportBrand = {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  website: string | null;
  supportEmail: string | null;
  /** URL of the logo image, or null to show the initials. */
  logoUrl: string | null;
};

const SEVERITY = { CRITICAL: "Critical", WARNING: "Warning", NOTICE: "Notice" } as const;

function pathOf(url: string | null): string {
  if (!url) return "-";
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

/** Reports are always light, so these do not use dark mode colors. */
function Change({ change }: { change: number | null }) {
  if (change === null) return <span className="text-zinc-500">-</span>;
  const label = change > 0 ? `Up ${change}` : change < 0 ? `Down ${Math.abs(change)}` : "No change";
  const tone = change > 0 ? "text-green-700" : change < 0 ? "text-red-700" : "text-zinc-600";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap font-medium ${tone}`}>
      <span aria-hidden="true">{change > 0 ? "▲" : change < 0 ? "▼" : "•"}</span>
      <span aria-hidden="true">{formatChange(change)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Position({ row }: { row: ReportKeywordRow }) {
  if (!row.checked) return <span className="text-zinc-500">Not checked</span>;
  return <span className="font-semibold tabular-nums">{formatPosition(row.position)}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 break-inside-avoid">
      <h2 className="text-lg font-semibold" style={{ color: "var(--brand-primary)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function LinkTable({ title, rows }: { title: string; rows: ReportBacklinkRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-left text-sm" aria-label={title}>
        <caption className="px-3 pt-2 text-left text-sm font-medium">{title}</caption>
        <thead className="border-b border-zinc-200 bg-zinc-50">
          <tr>
            {["Website", "Link text", "Type", "Rating"].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {rows.map((r) => (
            <tr key={`${r.domain}-${r.anchor}`}>
              <td className="px-3 py-2 font-medium">{r.domain}</td>
              <td className="px-3 py-2">{r.anchor}</td>
              <td className="px-3 py-2">{r.dofollow ? "Dofollow" : "Nofollow"}</td>
              <td className="px-3 py-2 tabular-nums">{r.rating}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rows({ rows, empty }: { rows: ReportKeywordRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-600">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Keyword
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Position
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Change
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Ranking page
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {rows.map((r) => (
            <tr key={r.phrase}>
              <td className="px-3 py-2 font-medium">{r.phrase}</td>
              <td className="px-3 py-2">
                <Position row={r} />
              </td>
              <td className="px-3 py-2">
                <Change change={r.change} />
              </td>
              <td className="max-w-56 truncate px-3 py-2 text-zinc-600">{pathOf(r.url)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The report as a web page. Used inside the agency app and on the public share page, so it only
 * ever shows the agency's own branding.
 */
export function ReportView({
  model,
  brand,
  titleTag: Title = "h1",
}: {
  model: ReportModel;
  brand: ReportBrand;
  /** Use "h2" when the page already has its own h1 (inside the agency app). */
  titleTag?: "h1" | "h2";
}) {
  const has = (key: ReportModel["sections"][number]) => model.sections.includes(key);
  const k = model.kpis;
  const max = Math.max(1, ...model.distribution.map((d) => d.count));
  const kpis: [string, string][] = [
    ["Keywords tracked", String(k.tracked)],
    ["Average position", k.averagePosition === null ? "-" : String(k.averagePosition)],
    ["In the top 3", String(k.top3)],
    ["On the first page", String(k.top10)],
    ["Moved up", String(k.improved)],
    ["Moved down", String(k.declined)],
    ["Visibility score", String(k.visibility)],
    ["Average change", k.averageChange === null ? "-" : formatChange(k.averageChange)],
  ];

  return (
    <article
      style={brandCssVars(brand) as React.CSSProperties}
      className="mx-auto max-w-4xl space-y-8 rounded-lg border border-zinc-200 bg-white p-6 text-zinc-900 sm:p-10"
    >
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the logo comes from our own authorized route
            <img
              src={brand.logoUrl}
              alt={`${brand.displayName} logo`}
              className="size-10 object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-full text-sm font-semibold"
              style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
            >
              {initials(brand.displayName)}
            </span>
          )}
          <span className="text-base font-semibold">{brand.displayName}</span>
        </div>
        <div className="h-1 rounded" style={{ background: "var(--brand-accent)" }} />
        <Title className="text-2xl font-semibold">{model.title}</Title>
        <p className="text-sm text-zinc-600">
          {model.clientName} | {model.domain} | {model.period.label}
        </p>
      </header>

      {has("summary") ? (
        <Section title="Summary">
          <p className="leading-relaxed">{model.summary}</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-3">
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                <dt className="mt-0.5 text-xs text-zinc-600">{label}</dt>
              </div>
            ))}
          </dl>
          {describeComparison(model.kpis, model.previous).map((line) => (
            <p key={line} className="text-sm text-zinc-700">
              {line}
            </p>
          ))}
        </Section>
      ) : null}

      {has("distribution") ? (
        <Section title="Ranking distribution">
          <ul className="space-y-1.5" aria-label="Keywords by position">
            {model.distribution.map((d) => (
              <li key={d.key} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0">{d.label}</span>
                <span
                  aria-hidden="true"
                  className="h-4 rounded"
                  style={{
                    width: `${d.count === 0 ? 0 : Math.max(2, (d.count / max) * 100)}%`,
                    maxWidth: "70%",
                    background: "var(--brand-accent)",
                  }}
                />
                <span className="tabular-nums">{d.count}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {has("movers") ? (
        <>
          <Section title="Biggest gains">
            <Rows rows={model.movers.up} empty="No keywords moved up in this period." />
          </Section>
          <Section title="Biggest drops">
            <Rows rows={model.movers.down} empty="No keywords moved down in this period." />
          </Section>
        </>
      ) : null}

      {has("opportunities") ? (
        <Section title="Keyword opportunities">
          <p className="text-sm text-zinc-600">
            These keywords are close to the top. A little work could move them onto page one.
          </p>
          <Rows rows={model.opportunities} empty="No keywords between position 4 and 20." />
        </Section>
      ) : null}

      {has("audit") ? (
        <Section title="Site health">
          {model.audit ? (
            <p>
              Health score <strong>{model.audit.healthScore}</strong> out of 100 on{" "}
              {model.audit.finishedOn}. {model.audit.pagesCrawled} pages checked.{" "}
              {model.audit.counts.critical} critical, {model.audit.counts.warning} warnings,{" "}
              {model.audit.counts.notice} notices.
            </p>
          ) : (
            <p className="text-sm text-zinc-600">No site check has been finished yet.</p>
          )}
        </Section>
      ) : null}

      {has("backlinks") ? (
        <Section title="Backlinks">
          {model.backlinks ? (
            <>
              {describeBacklinks(model.backlinks).map((line) => (
                <p key={line}>{line}</p>
              ))}
              <LinkTable title="Strongest new links" rows={model.backlinks.topNew} />
              <LinkTable title="Strongest lost links" rows={model.backlinks.topLost} />
            </>
          ) : (
            <p className="text-sm text-zinc-600">No backlink check has been done yet.</p>
          )}
        </Section>
      ) : null}

      {has("competitors") ? (
        <Section title="Competitors">
          {model.competitors ? (
            <>
              <p className="text-sm text-zinc-600">
                Based on the top 10 results of {model.competitors.compared} tracked{" "}
                {model.competitors.compared === 1 ? "keyword" : "keywords"}.
              </p>
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <table className="w-full text-left text-sm" aria-label="Competitor comparison">
                  <thead className="border-b border-zinc-200 bg-zinc-50">
                    <tr>
                      {[
                        "Competitor",
                        "In top 10",
                        "Ahead of you",
                        "Behind you",
                        "Average position",
                      ].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {model.competitors.competitors.map((c) => (
                      <tr key={c.domain}>
                        <td className="px-3 py-2 font-medium">{c.domain}</td>
                        <td className="px-3 py-2 tabular-nums">{c.inTop10}</td>
                        <td className="px-3 py-2 tabular-nums">{c.theyAreAhead}</td>
                        <td className="px-3 py-2 tabular-nums">{c.youAreAhead}</td>
                        <td className="px-3 py-2 tabular-nums">{c.averagePosition ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {model.competitors.links && model.competitors.links.length > 0 ? (
                <div>
                  <p className="text-sm font-medium">Links side by side</p>
                  <ul aria-label="Links side by side" className="mt-1 space-y-0.5 text-sm">
                    {describeCompetitorLinks(model.competitors.links).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {model.competitors.gap.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-zinc-200">
                  <table className="w-full text-left text-sm" aria-label="Biggest keyword gaps">
                    <caption className="px-3 pt-2 text-left text-sm font-medium">
                      Keywords competitors rank for and you do not
                    </caption>
                    <thead className="border-b border-zinc-200 bg-zinc-50">
                      <tr>
                        {["Keyword", "Searches a month", "Competitor", "Their position"].map(
                          (h) => (
                            <th key={h} scope="col" className="px-3 py-2 font-medium">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {model.competitors.gap.map((g) => (
                        <tr key={`${g.competitor}-${g.keyword}`}>
                          <td className="px-3 py-2 font-medium">{g.keyword}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {g.volume.toLocaleString("en-US")}
                          </td>
                          <td className="px-3 py-2">{g.competitor}</td>
                          <td className="px-3 py-2 tabular-nums">{g.position}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-zinc-600">No competitors have been added yet.</p>
          )}
        </Section>
      ) : null}

      {has("ai") ? (
        <Section title="AI visibility">
          {model.ai ? (
            <>
              {describeAi(model.ai).map((line) => (
                <p key={line}>{line}</p>
              ))}
              {model.ai.prompts.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-zinc-200">
                  <table
                    className="w-full text-left text-sm"
                    aria-label="AI visibility by question"
                  >
                    <thead className="border-b border-zinc-200 bg-zinc-50">
                      <tr>
                        {["Question", "Engines that named the brand"].map((h) => (
                          <th key={h} scope="col" className="px-3 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {model.ai.prompts.map((p) => (
                        <tr key={p.text}>
                          <td className="px-3 py-2 font-medium">{p.text}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {p.mentioned} of {p.engines}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-zinc-600">No AI visibility check has been done yet.</p>
          )}
        </Section>
      ) : null}

      {has("reviews") ? (
        <Section title="Local reviews">
          {model.reviews ? (
            <>
              {describeReviews(model.reviews).map((line) => (
                <p key={line}>{line}</p>
              ))}
              {model.reviews.latest.length > 0 ? (
                <ul aria-label="Newest reviews" className="space-y-2">
                  {model.reviews.latest.map((r) => (
                    <li
                      key={`${r.author}-${r.publishedAt}-${r.text}`}
                      className="rounded-lg border border-zinc-200 p-3 text-sm"
                    >
                      <p className="font-medium">
                        {r.author}, {r.rating} {r.rating === 1 ? "star" : "stars"}
                      </p>
                      <p className="mt-1 text-zinc-700">{r.text}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-zinc-600">No review check has been done yet.</p>
          )}
        </Section>
      ) : null}

      {has("analytics") ? (
        <Section title="Search Console and Analytics">
          {model.analytics ? (
            describeAnalytics(model.analytics).map((line) => <p key={line}>{line}</p>)
          ) : (
            <p className="text-sm text-zinc-600">No Google data is connected for this period.</p>
          )}
        </Section>
      ) : null}

      {has("issues") ? (
        <Section title="Top issues">
          {model.issues.length === 0 ? (
            <p className="text-sm text-zinc-600">No issues to show.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Issue
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Severity
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Pages
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      What to do
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {model.issues.map((i) => (
                    <tr key={i.code}>
                      <td className="px-3 py-2 font-medium">{i.title}</td>
                      <td className="px-3 py-2">{SEVERITY[i.severity]}</td>
                      <td className="px-3 py-2 tabular-nums">{i.pages}</td>
                      <td className="px-3 py-2 text-zinc-600">{i.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      {has("rankings") ? (
        <Section title="All keyword rankings">
          <Rows rows={model.rankings} empty="No keywords are tracked yet." />
        </Section>
      ) : null}

      {has("goals") ? (
        <Section title="Goals">
          {model.goals && model.goals.length > 0 ? (
            <ul className="space-y-3">
              {model.goals.map((g) => (
                <li key={g.label} className="rounded-lg border border-zinc-200 p-3 text-sm">
                  <p className="font-medium">
                    {`${g.label}: ${g.current} of ${g.target} (${g.percent}%)`}
                  </p>
                  <p className="mt-0.5 text-zinc-700">{g.status}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">No goals are set for this project.</p>
          )}
        </Section>
      ) : null}

      {has("annotations") ? (
        <Section title="Timeline notes">
          {model.annotations && model.annotations.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {model.annotations.map((a) => (
                <li key={`${a.on}-${a.title}`}>
                  {`${a.on}: ${KIND_LABELS[a.kind] ?? "Note"}, ${a.title}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">No notes fall in this period.</p>
          )}
        </Section>
      ) : null}

      {has("notes") && model.notes ? (
        <Section title="Notes">
          <p className="whitespace-pre-line leading-relaxed">{model.notes}</p>
        </Section>
      ) : null}

      {model.sources && model.sources.length > 0 ? (
        <section aria-label="Data sources" className="text-xs text-zinc-600">
          <p className="font-medium">Data sources</p>
          <ul>
            {model.sources.map((src) => (
              <li key={src.label}>{describeSource(src)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-600">
        {brand.displayName}
        {brand.website ? ` | ${brand.website}` : ""}
        {brand.supportEmail ? ` | ${brand.supportEmail}` : ""}
      </footer>
    </article>
  );
}
