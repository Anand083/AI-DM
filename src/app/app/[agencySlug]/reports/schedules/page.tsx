import type { Metadata } from "next";
import Link from "next/link";
import { ScheduleForm } from "@/components/app/schedule-form";
import { ScheduleRowActions } from "@/components/app/schedule-row-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { describeSchedule } from "@/lib/report-schedule";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { getAgency } from "@/server/services/agency";
import { listProjects } from "@/server/services/projects";
import { getSchedule, listSchedules } from "@/server/services/report-schedules";
import { NotFoundError } from "@/server/services/errors";

export const metadata: Metadata = { title: "Report schedules" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function SchedulesPage({
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
  const [{ items, total }, agency, projects] = await Promise.all([
    listSchedules(ctx, { page, pageSize: PAGE_SIZE }),
    getAgency(ctx),
    listProjects(ctx, { pageSize: 100 }),
  ]);
  const canManage = can(ctx.role, "reports.create");
  const editId = typeof sp.edit === "string" ? sp.edit : undefined;
  const editing =
    canManage && editId
      ? await getSchedule(ctx, editId).catch((error) => {
          if (error instanceof NotFoundError) return null;
          throw error;
        })
      : null;
  const taken = new Set(
    (
      await db.reportSchedule.findMany({
        where: { agencyId: ctx.agencyId },
        select: { projectId: true },
        take: 1000,
      })
    ).map((s) => s.projectId),
  );
  const free = projects.rows
    .filter((p) => !taken.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, clientName: p.client.name }));
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: agency.timezone,
    }).format(d);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/app/${agencySlug}/reports`}
          className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
        >
          All reports
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Report schedules</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Send a report by email on its own, every week or every month. Times are in{" "}
          {agency.timezone}.
        </p>
      </div>

      {editing ? (
        <section aria-labelledby="edit-schedule" className="space-y-3">
          <h2 id="edit-schedule" className="text-lg font-semibold">
            Edit schedule for {editing.project.name}
          </h2>
          <ScheduleForm
            agencySlug={agencySlug}
            projects={[
              {
                id: editing.projectId,
                name: editing.project.name,
                clientName: editing.project.client.name,
              },
            ]}
            timezone={agency.timezone}
            edit={{
              scheduleId: editing.id,
              enabled: editing.enabled,
              frequency: editing.frequency,
              dayOfWeek: editing.dayOfWeek,
              dayOfMonth: editing.dayOfMonth,
              hour: editing.hour,
              recipients: editing.recipients,
              sections: editing.sections,
            }}
          />
          <Link
            href={`/app/${agencySlug}/reports/schedules`}
            className="text-sm underline underline-offset-4"
          >
            Cancel
          </Link>
        </section>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description="Add a schedule below to email a report to your client automatically."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm" aria-label="Schedules">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  {["Project", "When", "Sent to", "Next report", "Status", "Actions"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-medium">
                      {s.project.name}
                      <span className="block text-xs font-normal text-zinc-600 dark:text-zinc-400">
                        {s.project.client.name}
                      </span>
                    </td>
                    <td className="px-3 py-2">{describeSchedule(s)}</td>
                    <td className="px-3 py-2">{s.recipients.join(", ")}</td>
                    <td className="px-3 py-2">{s.enabled ? when(s.nextRunAt) : "-"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={s.enabled ? "success" : "neutral"}>
                        {s.enabled ? "On" : "Paused"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <Link
                          href={`/app/${agencySlug}/reports/schedules?edit=${s.id}`}
                          className="mr-3 text-sm underline underline-offset-4"
                        >
                          Edit<span className="sr-only"> schedule for {s.project.name}</span>
                        </Link>
                      ) : null}
                      {canManage ? (
                        <ScheduleRowActions
                          agencySlug={agencySlug}
                          scheduleId={s.id}
                          enabled={s.enabled}
                          label={s.project.name}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            basePath={`/app/${agencySlug}/reports/schedules`}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
          />
        </>
      )}

      {canManage ? (
        <section aria-labelledby="new-schedule" className="space-y-3">
          <h2 id="new-schedule" className="text-lg font-semibold">
            New schedule
          </h2>
          <ScheduleForm agencySlug={agencySlug} projects={free} timezone={agency.timezone} />
        </section>
      ) : null}
    </div>
  );
}
