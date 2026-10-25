import type { Metadata } from "next";
import { GoalPanel } from "@/components/app/goal-panel";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { listAnnotations } from "@/server/services/annotations";
import { listGoals } from "@/server/services/goals";

export const metadata: Metadata = { title: "Goals and notes" };
export const dynamic = "force-dynamic";

export default async function GoalsPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const [goals, notes] = await Promise.all([
    listGoals(ctx, projectId),
    listAnnotations(ctx, projectId),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Goals and notes</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Set a target and we save the number every day. Estimates are a straight line through
          recent days, so treat them as a rough guide. Timeline notes explain changes, and they can
          be added to reports.
        </p>
      </div>
      <GoalPanel
        agencySlug={agencySlug}
        projectId={projectId}
        canEdit={can(ctx.role, "content.edit")}
        canDelete={can(ctx.role, "content.delete")}
        goals={goals.map((g) => ({
          id: g.id,
          kind: g.kind,
          start: g.start,
          current: g.current,
          target: g.target,
          dueOn: g.dueOn,
          percent: g.percent,
          onTrack: g.onTrack,
          reachedOn: g.forecast?.reachedOn ?? null,
          points: g.series.length,
        }))}
        notes={notes}
      />
    </div>
  );
}
