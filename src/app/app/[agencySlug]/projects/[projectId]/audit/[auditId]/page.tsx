import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditProgress } from "@/components/app/audit-progress";
import { AuditStatusBadge, ScoreBadge, SeverityBadge } from "@/components/app/audit-widgets";
import { IssueStateButtons } from "@/components/app/issue-state-buttons";
import { CreateTaskFromIssueButton } from "@/components/app/task-extras";
import { RunAuditButton } from "@/components/app/run-audit-button";
import { StatCard } from "@/components/app/rank-widgets";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { ISSUE_CATALOG } from "@/server/audit/issue-catalog";
import { formatVital, vitalRating } from "@/lib/audit-math";
import { getAgency } from "@/server/services/agency";
import { loadUrlStates } from "@/server/services/audit-issue-state";
import {
  compareWithPrevious,
  getAudit,
  getAuditDiagnostics,
  getPageChanges,
  getIssueGroups,
  listAuditPages,
  listIssueUrls,
  PAGE_SORTS,
  SAMPLE_URLS,
  type PageSort,
} from "@/server/services/audits";
import { NotFoundError } from "@/server/services/errors";

export const metadata: Metadata = { title: "Audit results" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuditResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string; auditId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId, auditId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const orNotFound = (error: unknown): never => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  };
  const audit = await getAudit(ctx, projectId, auditId).catch(orNotFound);
  const agency = await getAgency(ctx);
  const base = `/app/${agencySlug}/projects/${projectId}/audit`;
  const here = `${base}/${auditId}`;
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: agency.timezone,
    }).format(d);

  const back = (
    <p className="text-sm">
      <Link href={base} className="underline-offset-4 hover:underline">
        All audits
      </Link>
    </p>
  );

  if (audit.status === "QUEUED" || audit.status === "RUNNING") {
    return (
      <div className="space-y-6">
        {back}
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Audit in progress</h2>
          <AuditStatusBadge status={audit.status} />
        </div>
        <AuditProgress
          agencySlug={agencySlug}
          projectId={projectId}
          auditId={auditId}
          initialProgress={audit.progress}
        />
      </div>
    );
  }

  if (audit.status === "FAILED") {
    return (
      <div className="space-y-6">
        {back}
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">This audit did not finish</h2>
          <AuditStatusBadge status="FAILED" />
        </div>
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {audit.error ?? "Something went wrong."}
        </p>
        {can(ctx.role, "tools.run") ? (
          <RunAuditButton agencySlug={agencySlug} projectId={projectId} label="Try again" />
        ) : null}
      </div>
    );
  }

  // Completed.
  const view = one(sp.view) === "pages" ? "pages" : "issues";
  const issueCode = one(sp.issue);
  const counts = audit.counts ?? { critical: 0, warning: 0, notice: 0, byCode: {} };
  const [comparison, diagnostics, changes] = await Promise.all([
    compareWithPrevious(ctx, projectId, auditId),
    getAuditDiagnostics(ctx, projectId, auditId),
    getPageChanges(ctx, projectId, auditId),
  ]);

  const tabLink = (label: string, v: "issues" | "pages") => (
    <Link
      href={v === "issues" ? here : `${here}?view=pages`}
      aria-current={view === v ? "page" : undefined}
      className={`inline-block border-b-2 px-1 py-2 text-sm font-medium ${view === v ? "border-zinc-900 dark:border-zinc-100" : "border-transparent text-zinc-600 dark:text-zinc-400"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-8">
      {back}
      <div className="flex flex-wrap items-center gap-6">
        <ScoreBadge score={audit.healthScore ?? 0} />
        <div>
          <h2 className="text-lg font-semibold">Audit results</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {audit.finishedAt ? date(audit.finishedAt) : date(audit.createdAt)} ·{" "}
            {audit.pagesCrawled} pages checked
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Critical" value={String(counts.critical)} hint="Fix these first" />
        <StatCard label="Warnings" value={String(counts.warning)} />
        <StatCard label="Notices" value={String(counts.notice)} hint="Small improvements" />
      </div>

      {comparison ? (
        <section
          aria-labelledby="compare-heading"
          className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h3 id="compare-heading" className="font-semibold">
            Compared with the audit on {date(comparison.previousDate)}
            {comparison.previousScore !== null ? ` (score ${comparison.previousScore})` : ""}
          </h3>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <li>
              <strong className="text-green-700 dark:text-green-400">{comparison.fixed}</strong>{" "}
              fixed
            </li>
            <li>
              <strong className="text-red-700 dark:text-red-400">{comparison.new}</strong> new
            </li>
            <li>
              <strong>{comparison.stillPresent}</strong> still there
            </li>
          </ul>
        </section>
      ) : null}

      {diagnostics ? (
        <section
          aria-labelledby="diag-heading"
          className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h3 id="diag-heading" className="font-semibold">
            robots.txt and sitemap
          </h3>
          <ul className="space-y-1 text-sm">
            <li>
              robots.txt:{" "}
              {!diagnostics.robots.found
                ? "not found."
                : diagnostics.robots.blocksAll
                  ? "blocks the whole site from search engines. Fix this first."
                  : `found, ${diagnostics.robots.disallowRules} ${diagnostics.robots.disallowRules === 1 ? "rule" : "rules"} that keep crawlers out of some paths.`}
            </li>
            <li>
              Sitemap:{" "}
              {!diagnostics.sitemap.found
                ? "not found."
                : `found, ${diagnostics.sitemap.urls} addresses listed${diagnostics.sitemap.badUrls > 0 ? `, ${diagnostics.sitemap.badUrls} of them broken, redirected or blocked` : ", none broken"}.`}
            </li>
            {diagnostics.robots.sitemapUrls.length > 0 ? (
              <li className="break-all">
                Listed in robots.txt: {diagnostics.robots.sitemapUrls.join(", ")}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {changes &&
      changes.added.length +
        changes.removed.length +
        changes.statusChanged.length +
        changes.titleChanged.length +
        changes.contentChanged.length >
        0 ? (
        <section
          aria-labelledby="changes-heading"
          className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h3 id="changes-heading" className="font-semibold">
            Pages that changed since the last audit
          </h3>
          <ul aria-label="Page changes" className="space-y-1 text-sm">
            {changes.statusChanged.map((c) => (
              <li key={`s-${c.url}`} className="break-all">
                {c.url}: status changed from {c.from} to {c.to}
              </li>
            ))}
            {changes.titleChanged.map((c) => (
              <li key={`t-${c.url}`} className="break-all">
                {c.url}: title changed from &quot;{c.from ?? "none"}&quot; to &quot;
                {c.to ?? "none"}&quot;
              </li>
            ))}
            {changes.contentChanged.map((c) => (
              <li key={`c-${c.url}`} className="break-all">
                {c.url}: text length went from {c.from} to {c.to} words
              </li>
            ))}
            {changes.added.map((u) => (
              <li key={`a-${u}`} className="break-all">
                New page found: {u}
              </li>
            ))}
            {changes.removed.map((u) => (
              <li key={`r-${u}`} className="break-all">
                Page no longer found: {u}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav aria-label="Audit sections" className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="-mb-px flex gap-4">
          {tabLink("Issues", "issues")}
          {tabLink("Pages", "pages")}
        </div>
      </nav>

      {view === "pages" ? (
        <PagesView ctx={ctx} projectId={projectId} auditId={auditId} here={here} sp={sp} />
      ) : issueCode ? (
        <IssueUrlsView
          agencySlug={agencySlug}
          ctx={ctx}
          projectId={projectId}
          auditId={auditId}
          here={here}
          code={issueCode}
          page={pageFromParams(sp.page)}
        />
      ) : (
        <IssuesView
          agencySlug={agencySlug}
          ctx={ctx}
          projectId={projectId}
          auditId={auditId}
          here={here}
          comparison={comparison?.byCode}
        />
      )}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof getPageContext>>["ctx"];

async function IssuesView({
  agencySlug,
  ctx,
  projectId,
  auditId,
  here,
  comparison,
}: {
  agencySlug: string;
  ctx: Ctx;
  projectId: string;
  auditId: string;
  here: string;
  comparison?: Record<string, { fixed: number; new: number; stillPresent: number }>;
}) {
  const groups = await getIssueGroups(ctx, projectId, auditId);
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No problems found"
        description="This audit did not find anything to fix. Nice work."
      />
    );
  }
  return (
    <ul className="space-y-3">
      {groups.map((g) => {
        const delta = comparison?.[g.code];
        return (
          <li key={g.code}>
            <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                <SeverityBadge severity={g.severity} />
                <span className="font-medium">{g.title}</span>
                <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">
                  {g.count} {g.count === 1 ? "page" : "pages"}
                  {g.ignored > 0 ? ` · ${g.ignored} ignored` : ""}
                  {g.resolved > 0 ? ` · ${g.resolved} marked fixed` : ""}
                  {delta && (delta.new > 0 || delta.fixed > 0)
                    ? ` · ${delta.new} new, ${delta.fixed} fixed`
                    : ""}
                </span>
              </summary>
              <div className="space-y-4 border-t border-zinc-200 px-4 py-4 text-sm dark:border-zinc-800">
                <div>
                  <h4 className="font-semibold">Why it matters</h4>
                  <p className="mt-1">{g.why}</p>
                </div>
                <div>
                  <h4 className="font-semibold">How to fix it</h4>
                  <p className="mt-1">{g.fix}</p>
                </div>
                {can(ctx.role, "content.edit") ? (
                  <IssueStateButtons
                    agencySlug={agencySlug}
                    projectId={projectId}
                    auditId={auditId}
                    code={g.code}
                  />
                ) : null}
                {can(ctx.role, "content.edit") ? (
                  <CreateTaskFromIssueButton
                    agencySlug={agencySlug}
                    projectId={projectId}
                    auditId={auditId}
                    code={g.code}
                  />
                ) : null}
                <div>
                  <h4 className="font-semibold">Pages affected</h4>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {g.sampleUrls.map((u) => (
                      <li key={u} className="break-all">
                        {u}
                      </li>
                    ))}
                  </ul>
                  {g.count > SAMPLE_URLS ? (
                    <Link
                      href={`${here}?issue=${g.code}`}
                      className="mt-2 inline-block underline-offset-4 hover:underline"
                    >
                      See all {g.count} pages
                    </Link>
                  ) : null}
                </div>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

async function IssueUrlsView({
  agencySlug,
  ctx,
  projectId,
  auditId,
  here,
  code,
  page,
}: {
  agencySlug: string;
  ctx: Ctx;
  projectId: string;
  auditId: string;
  here: string;
  code: string;
  page: number;
}) {
  if (!(code in ISSUE_CATALOG)) notFound();
  const { urls, total, info } = await listIssueUrls(ctx, projectId, auditId, code, {
    page,
    pageSize: PAGE_SIZE,
  });
  const states = await loadUrlStates(ctx.agencyId, projectId, code, urls);
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href={here} className="underline-offset-4 hover:underline">
          All issues
        </Link>
      </p>
      <div className="flex items-center gap-3">
        <SeverityBadge severity={info.severity} />
        <h3 className="text-lg font-semibold">{info.title}</h3>
      </div>
      <p className="text-sm">{info.fix}</p>
      <ul aria-label="Affected pages" className="list-disc space-y-0.5 pl-5 text-sm">
        {urls.map((u) => (
          <li key={u} className="break-all">
            {u}
            {states.get(u)?.status === "IGNORED" ? " (ignored)" : ""}
            {states.get(u)?.status === "RESOLVED" ? " (marked fixed)" : ""}
          </li>
        ))}
      </ul>
      {can(ctx.role, "content.edit") ? (
        <IssueStateButtons
          agencySlug={agencySlug}
          projectId={projectId}
          auditId={auditId}
          code={code}
          urls={urls}
        />
      ) : null}
      <Pagination
        basePath={here}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        params={{ issue: code }}
      />
    </div>
  );
}

async function PagesView({
  ctx,
  projectId,
  auditId,
  here,
  sp,
}: {
  ctx: Ctx;
  projectId: string;
  auditId: string;
  here: string;
  sp: Record<string, string | string[] | undefined>;
}) {
  const sort = (
    PAGE_SORTS.includes(one(sp.sort) as PageSort) ? one(sp.sort) : "issues"
  ) as PageSort;
  const page = pageFromParams(sp.page);
  const { rows, total } = await listAuditPages(ctx, projectId, auditId, {
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const sortLink = (value: PageSort, label: string) => (
    <Link
      href={`${here}?view=pages&sort=${value}`}
      aria-current={sort === value ? "true" : undefined}
      className={sort === value ? "font-semibold underline" : "underline-offset-4 hover:underline"}
    >
      {label}
    </Link>
  );
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap gap-3 text-sm">
        Sort by: {sortLink("issues", "Most problems")} {sortLink("slowest", "Slowest")}{" "}
        {sortLink("url", "Address")}
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm" aria-label="Pages checked">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Page
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Load time
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Words
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                LCP
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                CLS
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                INP
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Problems
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="max-w-md break-all px-3 py-2">
                  <div className="font-medium">{p.title ?? "(no title)"}</div>
                  <div className="text-zinc-600 dark:text-zinc-400">{p.url}</div>
                </td>
                <td className="px-3 py-2 tabular-nums">{p.statusCode}</td>
                <td className="px-3 py-2 tabular-nums">{(p.loadTimeMs / 1000).toFixed(1)} s</td>
                <td className="px-3 py-2 tabular-nums">{p.wordCount}</td>
                {(["lcp", "cls", "inp"] as const).map((metric) => {
                  const value = { lcp: p.lcpMs, cls: p.cls, inp: p.inpMs }[metric];
                  const rating = vitalRating(metric, value);
                  return (
                    <td key={metric} className="px-3 py-2 tabular-nums">
                      {formatVital(metric, value)}
                      {rating ? <span className="sr-only"> ({rating})</span> : null}
                      {rating === "poor" ? (
                        <span aria-hidden="true" className="ml-1 text-red-700 dark:text-red-400">
                          !
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td className="px-3 py-2 tabular-nums">{p.issueCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath={here}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        params={{ view: "pages", sort: sort === "issues" ? undefined : sort }}
      />
    </div>
  );
}
