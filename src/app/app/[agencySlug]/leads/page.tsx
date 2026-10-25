import type { Metadata } from "next";
import Link from "next/link";
import { EmbedCodePanel } from "@/components/app/embed-code-panel";
import { LeadDelete } from "@/components/app/lead-delete";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getEnv } from "@/env";
import { embedCode } from "@/lib/lead-widget";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getAgency } from "@/server/services/agency";
import { listLeads } from "@/server/services/leads";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STATUS = {
  QUEUED: { label: "Waiting", tone: "neutral" },
  RUNNING: { label: "Checking", tone: "neutral" },
  DONE: { label: "Done", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
} as const;

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const page = pageFromParams(sp.page);
  const [{ rows, total }, agency] = await Promise.all([
    listLeads(ctx, { page, pageSize: PAGE_SIZE }),
    getAgency(ctx),
  ]);
  const base = `/app/${agencySlug}/leads`;
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: agency.timezone,
    }).format(d);
  const canDelete = can(ctx.role, "content.delete");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Put the free website check on your own website. Visitors enter their website and email and
          get a mini audit. You get the lead here and by email. Each finished check counts against
          your plan&apos;s lead audits.
        </p>
      </div>

      <section aria-labelledby="embed-heading" className="space-y-3">
        <h2 id="embed-heading" className="text-lg font-semibold">
          Add it to your website
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Paste this line where the check should appear. It uses your name, logo and colours from
          the Branding page.
        </p>
        <EmbedCodePanel code={embedCode(getEnv().APP_URL, agencySlug)} />
        <p className="text-sm">
          <Link
            href={`/widget/${agencySlug}`}
            target="_blank"
            className="underline underline-offset-4"
          >
            Open the check as a visitor sees it
          </Link>
        </p>
      </section>

      <section aria-labelledby="leads-heading" className="space-y-3">
        <h2 id="leads-heading" className="text-lg font-semibold">
          Your leads
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            title="No leads yet"
            description="When a visitor uses the free check on your website, they show up here."
          />
        ) : (
          <>
            <div
              role="region"
              aria-label="Leads list"
              tabIndex={0}
              className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <table className="w-full text-left text-sm" aria-label="Leads">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    {["Received", "Email", "Website", "Score", "Status", "Problems found"].map(
                      (h) => (
                        <th key={h} scope="col" className="px-4 py-2 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                    {canDelete ? (
                      <th scope="col" className="px-4 py-2 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900"
                    >
                      <td className="whitespace-nowrap px-4 py-2">{date(r.createdAt)}</td>
                      <td className="px-4 py-2">
                        <a href={`mailto:${r.email}`} className="underline underline-offset-4">
                          {r.email}
                        </a>
                      </td>
                      <td className="px-4 py-2">{r.domain}</td>
                      <td className="px-4 py-2 tabular-nums">{r.healthScore ?? "-"}</td>
                      <td className="px-4 py-2">
                        <Badge tone={STATUS[r.status as keyof typeof STATUS]?.tone ?? "neutral"}>
                          {STATUS[r.status as keyof typeof STATUS]?.label ?? r.status}
                        </Badge>
                      </td>
                      <td className="min-w-[14rem] px-4 py-2">
                        {r.issues.length === 0 ? (
                          <span className="text-zinc-500">-</span>
                        ) : (
                          <details>
                            <summary className="cursor-pointer">{r.issues.length} problems</summary>
                            <ul className="mt-2 list-disc space-y-1 pl-4">
                              {r.issues.map((i) => (
                                <li key={i.code}>{i.title}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      {canDelete ? (
                        <td className="px-4 py-2">
                          <LeadDelete agencySlug={agencySlug} leadId={r.id} email={r.email} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath={base}
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              label="Lead pages"
            />
          </>
        )}
      </section>
    </div>
  );
}
