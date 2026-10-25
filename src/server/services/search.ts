import "server-only";
import { cleanSearchText } from "@/lib/saved-views";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { ForbiddenError } from "./errors";

/** `path` is added after `/app/[agencySlug]`. */
export type SearchHit = { id: string; label: string; detail: string; path: string };
export type SearchResults = {
  query: string | null;
  clients: SearchHit[];
  projects: SearchHit[];
  keywords: SearchHit[];
  tasks: SearchHit[];
};

const PER_TYPE = 8;

/** Looks in clients, projects, keywords and tasks of this agency only. Short text gives nothing. */
export async function globalSearch(
  ctx: TenantContext,
  text: string | undefined,
): Promise<SearchResults> {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
  const q = cleanSearchText(text);
  const empty = { query: q, clients: [], projects: [], keywords: [], tasks: [] };
  if (!q) return empty;
  const like = { contains: q, mode: "insensitive" as const };
  const live = { deletedAt: null, client: { deletedAt: null } };
  const [clients, projects, keywords, tasks] = await Promise.all([
    db.client.findMany({
      where: { agencyId: ctx.agencyId, deletedAt: null, name: like },
      select: { id: true, name: true, website: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: PER_TYPE,
    }),
    db.project.findMany({
      where: { agencyId: ctx.agencyId, ...live, OR: [{ name: like }, { domain: like }] },
      select: { id: true, name: true, domain: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: PER_TYPE,
    }),
    db.keyword.findMany({
      where: { agencyId: ctx.agencyId, phrase: like, project: live },
      select: {
        id: true,
        phrase: true,
        currentPosition: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ phrase: "asc" }, { id: "asc" }],
      take: PER_TYPE,
    }),
    db.task.findMany({
      where: { agencyId: ctx.agencyId, title: like },
      select: { id: true, title: true, status: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: PER_TYPE,
    }),
  ]);
  return {
    query: q,
    clients: clients.map((c) => ({
      id: c.id,
      label: c.name,
      detail: c.website ?? "Client",
      path: `/clients/${c.id}`,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      label: p.name,
      detail: p.domain,
      path: `/projects/${p.id}`,
    })),
    keywords: keywords.map((k) => ({
      id: k.id,
      label: k.phrase,
      detail: `${k.project.name}, ${k.currentPosition ? `position ${k.currentPosition}` : "not ranked"}`,
      path: `/projects/${k.project.id}/rankings`,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      label: t.title,
      detail: t.status === "DONE" ? "Done" : "Open",
      path: `/tasks/${t.id}`,
    })),
  };
}
