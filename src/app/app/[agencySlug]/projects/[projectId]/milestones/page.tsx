import type { Metadata } from "next";
import { MilestonePanel } from "@/components/app/milestone-panel";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { listMilestones } from "@/server/services/milestones";

export const metadata: Metadata = { title: "Milestones" };
export const dynamic = "force-dynamic";

export default async function MilestonesPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const milestones = await listMilestones(ctx, projectId);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Milestones</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Goals for this website. Link tasks to a milestone on the task page; the progress is worked
          out from those tasks, and clients can follow it in their portal.
        </p>
      </div>
      <MilestonePanel
        agencySlug={agencySlug}
        projectId={projectId}
        canEdit={can(ctx.role, "content.edit")}
        canDelete={can(ctx.role, "content.delete")}
        milestones={milestones.map((m) => ({
          id: m.id,
          title: m.title,
          dueOn: m.dueOn,
          reached: m.completedAt !== null,
          clientVisible: m.clientVisible,
          total: m.total,
          done: m.done,
          percent: m.percent,
        }))}
      />
    </div>
  );
}
