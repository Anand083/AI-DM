import type { PrismaClient } from "@prisma/client";
import { addDays } from "@/lib/google-metrics";
import type { GoalKind } from "@/lib/goals";
import { averagePosition } from "@/lib/rank-math";

type Client = Pick<
  PrismaClient,
  "keyword" | "audit" | "searchConsoleDay" | "ga4Day" | "reviewSnapshot" | "goal" | "goalPoint"
>;

const day = (v: string) => new Date(`${v}T00:00:00Z`);

/**
 * The number a goal measures on one UTC day, in the unit the goal is stored in.
 * Null when there is no data yet (for example no Google connection), so no point is saved.
 */
export async function currentGoalValue(
  db: Client,
  agencyId: string,
  projectId: string,
  kind: string,
  date: string,
): Promise<number | null> {
  const base = { agencyId, projectId };
  switch (kind as GoalKind) {
    case "TOP10_KEYWORDS":
    case "AVG_POSITION": {
      const rows = await db.keyword.findMany({
        where: { ...base, lastCheckedOn: { not: null } },
        select: { currentPosition: true },
        take: 5000,
      });
      if (rows.length === 0) return null;
      const positions = rows.map((r) => r.currentPosition);
      if (kind === "TOP10_KEYWORDS") return positions.filter((p) => p !== null && p <= 10).length;
      const avg = averagePosition(positions);
      return avg === null ? null : Math.round(avg * 10);
    }
    case "HEALTH_SCORE": {
      const audit = await db.audit.findFirst({
        where: { ...base, status: "COMPLETED", healthScore: { not: null } },
        select: { healthScore: true },
        orderBy: { finishedAt: "desc" },
      });
      return audit?.healthScore ?? null;
    }
    case "CLICKS_28D": {
      const rows = await db.searchConsoleDay.findMany({
        where: { ...base, date: { gte: day(addDays(date, -27)), lte: day(date) } },
        select: { clicks: true },
        take: 40,
      });
      return rows.length === 0 ? null : rows.reduce((a, r) => a + r.clicks, 0);
    }
    case "SESSIONS_28D": {
      const rows = await db.ga4Day.findMany({
        where: { ...base, date: { gte: day(addDays(date, -27)), lte: day(date) } },
        select: { sessions: true },
        take: 40,
      });
      return rows.length === 0 ? null : rows.reduce((a, r) => a + r.sessions, 0);
    }
    case "REVIEW_RATING": {
      const snap = await db.reviewSnapshot.findFirst({
        where: { ...base, takenOn: { lte: day(date) } },
        select: { ratingTenths: true },
        orderBy: { takenOn: "desc" },
      });
      return snap?.ratingTenths ?? null;
    }
    default:
      return null;
  }
}

/**
 * Saves today's value of every goal that has no point for today yet. The first value also
 * becomes the goal's start value. Safe to run many times a day.
 */
export async function runGoalSnapshots(deps: {
  db: Client;
  now: Date;
  batchSize?: number;
}): Promise<{ scanned: number; saved: number }> {
  const { db } = deps;
  const date = deps.now.toISOString().slice(0, 10);
  const today = day(date);
  const batchSize = deps.batchSize ?? 200;
  let cursor: string | undefined;
  let scanned = 0;
  let saved = 0;
  for (;;) {
    const goals = await db.goal.findMany({
      where: {
        points: { none: { on: today } },
        project: {
          deletedAt: null,
          client: { deletedAt: null, status: "ACTIVE" },
          agency: { status: "ACTIVE", deletedAt: null },
        },
      },
      select: { id: true, agencyId: true, projectId: true, kind: true, startValue: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (goals.length === 0) break;
    scanned += goals.length;
    for (const goal of goals) {
      const value = await currentGoalValue(db, goal.agencyId, goal.projectId, goal.kind, date);
      if (value === null) continue;
      const result = await db.goalPoint.createMany({
        data: [{ agencyId: goal.agencyId, goalId: goal.id, on: today, value }],
        skipDuplicates: true,
      });
      saved += result.count;
      if (goal.startValue === null) {
        await db.goal.updateMany({
          where: { id: goal.id, agencyId: goal.agencyId, startValue: null },
          data: { startValue: value },
        });
      }
    }
    cursor = goals[goals.length - 1]!.id;
    if (goals.length < batchSize) break;
  }
  return { scanned, saved };
}
