import "server-only";
import type { Prisma } from "@prisma/client";
import { buildProgress, type Progress } from "@/lib/progress";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { ForbiddenError, NotFoundError } from "./errors";

const MAX_KEYWORDS = 5000;
const dayText = (d: Date) => d.toISOString().slice(0, 10);

async function load(ctx: TenantContext, keywordWhere: Prisma.KeywordWhereInput): Promise<Progress> {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
  const where = { agencyId: ctx.agencyId, lastCheckedOn: { not: null }, ...keywordWhere };
  const keywords = await db.keyword.findMany({
    where,
    select: { id: true, currentPosition: true, lastCheckedOn: true },
    take: MAX_KEYWORDS,
  });
  if (keywords.length === 0) return buildProgress([]);
  const firsts = await db.rankCheck.findMany({
    where: { agencyId: ctx.agencyId, keywordId: { in: keywords.map((k) => k.id) } },
    select: { keywordId: true, date: true, position: true },
    orderBy: [{ keywordId: "asc" }, { date: "asc" }],
    distinct: ["keywordId"],
    take: MAX_KEYWORDS,
  });
  const first = new Map(firsts.map((f) => [f.keywordId, f]));
  return buildProgress(
    keywords.flatMap((k) => {
      const f = first.get(k.id);
      if (!f || !k.lastCheckedOn) return [];
      return [
        {
          firstDate: dayText(f.date),
          firstPosition: f.position,
          currentDate: dayText(k.lastCheckedOn),
          currentPosition: k.currentPosition,
        },
      ];
    }),
  );
}

/** How a project's keywords moved since their first check. */
export async function getProjectProgress(ctx: TenantContext, projectId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, agencyId: ctx.agencyId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Project not found.");
  return load(ctx, { projectId });
}

/** The same, for every project of a client together. */
export async function getClientProgress(ctx: TenantContext, clientId: string) {
  const client = await db.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError("Client not found.");
  return load(ctx, { project: { clientId, deletedAt: null } });
}
