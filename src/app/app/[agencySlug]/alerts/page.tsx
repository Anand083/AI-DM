import type { Metadata } from "next";
import Link from "next/link";
import { MarkAllReadButton, MarkReadButton } from "@/components/app/alert-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { pageFromParams, Pagination } from "@/components/ui/pagination";
import { getPageContext } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";
import { getBellData, listAlerts } from "@/server/services/alerts";

export const metadata: Metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SEVERITY = {
  INFO: ["Good news", "neutral"],
  WARNING: ["Warning", "warning"],
  CRITICAL: ["Important", "danger"],
} as const;

export default async function AlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const unreadOnly = one(sp.show) === "unread";
  const page = pageFromParams(sp.page);
  const [{ rows, total }, agency, bell] = await Promise.all([
    listAlerts(ctx, { unreadOnly, page, pageSize: PAGE_SIZE }),
    getAgency(ctx),
    getBellData(ctx),
  ]);
  const base = `/app/${agencySlug}/alerts`;
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: agency.timezone,
    }).format(d);

  const link = (a: (typeof rows)[number]) => {
    const data = (a.data ?? {}) as { auditId?: string };
    if (a.type === "TASK_DUE") return `/app/${agencySlug}/tasks?view=overdue`;
    if (!a.projectId) return null;
    if (a.type === "CLIENT_RESPONSE") return `/app/${agencySlug}/tasks`;
    const project = `/app/${agencySlug}/projects/${a.projectId}`;
    if (a.type === "COMPETITOR_MOVE") return `${project}/competitors`;
    if (a.type === "GOOGLE_ANOMALY" || a.type === "GOOGLE_RECONNECT") return `${project}/analytics`;
    if (a.type === "BACKLINKS_LOST") return `${project}/backlinks?filter=lost`;
    if (a.type === "AI_MENTION_LOST") return `${project}/ai-visibility`;
    if (a.type === "NEW_REVIEW") return `${project}/reviews`;
    return a.type === "AUDIT_CRITICAL" && data.auditId
      ? `${project}/audit/${data.auditId}`
      : `${project}/rankings`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <MarkAllReadButton agencySlug={agencySlug} disabled={bell.unread === 0} />
      </div>

      <nav
        aria-label="Filter alerts"
        className="flex gap-4 border-b border-zinc-200 dark:border-zinc-800"
      >
        {[
          ["All", base, !unreadOnly],
          [`Unread (${bell.unread})`, `${base}?show=unread`, unreadOnly],
        ].map(([label, href, active]) => (
          <Link
            key={String(href)}
            href={String(href)}
            aria-current={active ? "page" : undefined}
            className={`-mb-px inline-block border-b-2 px-1 py-2 text-sm font-medium ${active ? "border-zinc-900 dark:border-zinc-100" : "border-transparent text-zinc-600 dark:text-zinc-400"}`}
          >
            {String(label)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          title={unreadOnly ? "No unread alerts" : "No alerts yet"}
          description="We tell you here when rankings move a lot, when a keyword reaches the top 10, and when a site audit finds serious problems."
        />
      ) : (
        <>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rows.map((a) => {
              const [label, tone] = SEVERITY[a.severity];
              const href = link(a);
              return (
                <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone}>{label}</Badge>
                      {a.readAt === null ? <Badge tone="success">New</Badge> : null}
                      <h2
                        className={`text-sm ${a.readAt === null ? "font-semibold" : "font-medium"}`}
                      >
                        {a.title}
                      </h2>
                    </div>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{a.body}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{date(a.createdAt)}</p>
                    {href ? (
                      <Link
                        href={href}
                        className="inline-block text-sm underline-offset-4 hover:underline"
                      >
                        Open
                      </Link>
                    ) : null}
                  </div>
                  {a.readAt === null ? (
                    <MarkReadButton agencySlug={agencySlug} alertId={a.id} title={a.title} />
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Pagination
            basePath={base}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            params={{ show: unreadOnly ? "unread" : undefined }}
          />
        </>
      )}
    </div>
  );
}
