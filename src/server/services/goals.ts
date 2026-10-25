import "server-only";
import { z } from "zod";
import { dateText } from "@/lib/date-text";
import {
  GOAL_KINDS,
  forecastGoal,
  goalPercent,
  onTrack,
  toStored,
  type GoalKind,
} from "@/lib/goals";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db, rawDb } from "@/server/db/client";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError } from "./errors";
import { currentGoalValue } from "./goal-runner";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);
const kinds = GOAL_KINDS.map((k) => k.key) as [GoalKind, ...GoalKind[]];

export const goalSchema = z.object({
  kind: z.enum(kinds, { message: "Choose what to measure." }),
  /** What a person types: 6.5 for a position, 20 for keywords. */
  target: z.number({ message: "Enter a number." }).min(0, "Enter zero or more.").max(1_000_000),
  dueOn: dateText.nullable().default(null),
});

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

/** Goals of a project with progress, and an estimate when the saved points allow one. */
export async function listGoals(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  return loadGoals(ctx.agencyId, projectId);
}

/** The same without a person (used by reports). The caller has checked the project. */
export async function loadGoals(agencyId: string, projectId: string) {
  const goals = await db.goal.findMany({
    where: { agencyId, projectId },
    select: { id: true, kind: true, target: true, startValue: true, dueOn: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return Promise.all(
    goals.map(async (g) => {
      const points = await db.goalPoint.findMany({
        where: { agencyId, goalId: g.id },
        select: { on: true, value: true },
        orderBy: { on: "desc" },
        take: 60,
      });
      const series = points.map((p) => ({ on: day(p.on), value: p.value })).reverse();
      const current = series.length > 0 ? series[series.length - 1]!.value : null;
      const dueOn = g.dueOn ? day(g.dueOn) : null;
      const forecast = forecastGoal(g.kind, series, g.target, dueOn);
      return {
        id: g.id,
        kind: g.kind,
        target: g.target,
        start: g.startValue,
        dueOn,
        current,
        percent: goalPercent(g.kind, g.startValue, current, g.target),
        forecast,
        onTrack: onTrack(g.kind, forecast, g.target, dueOn),
        series,
      };
    }),
  );
}

export async function createGoal(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(goalSchema, raw);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  if ((await db.goal.count({ where: base })) >= 20) {
    throw new LimitExceededError("A project can have up to 20 goals.");
  }
  if (await db.goal.findFirst({ where: { ...base, kind: input.kind }, select: { id: true } })) {
    throw new ConflictError("This project already has a goal for that.");
  }
  const today = new Date().toISOString().slice(0, 10);
  const start = await currentGoalValue(rawDb, ctx.agencyId, projectId, input.kind, today);
  const created = await db.goal.create({
    data: {
      ...base,
      kind: input.kind,
      target: toStored(input.kind, input.target),
      startValue: start,
      dueOn: input.dueOn ? new Date(`${input.dueOn}T00:00:00Z`) : null,
    },
    select: { id: true },
  });
  if (start !== null) {
    await db.goalPoint.create({
      data: {
        agencyId: ctx.agencyId,
        goalId: created.id,
        on: new Date(`${today}T00:00:00Z`),
        value: start,
      },
    });
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "goal.created",
    targetType: "Goal",
    targetId: created.id,
    metadata: { projectId, kind: input.kind },
  });
  return created;
}

export async function deleteGoal(ctx: TenantContext, projectId: string, goalId: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const result = await db.goal.deleteMany({
    where: { id: goalId, agencyId: ctx.agencyId, projectId },
  });
  if (result.count === 0) throw new NotFoundError("Goal not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "goal.deleted",
    targetType: "Goal",
    targetId: goalId,
  });
}
