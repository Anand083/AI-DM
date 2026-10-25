import "server-only";
import { db } from "@/server/db/client";
import { NotFoundError } from "./errors";

export type ApiPage = { page: number; perPage: number };

export function readApiPage(params: URLSearchParams): ApiPage {
  const page = Math.max(1, Math.floor(Number(params.get("page") ?? 1)) || 1);
  const per = Math.floor(Number(params.get("per_page") ?? 50)) || 50;
  return { page: Math.min(page, 100_000), perPage: Math.min(Math.max(per, 1), 100) };
}

const skipOf = (p: ApiPage) => (p.page - 1) * p.perPage;

/** Public API reads. Each one returns a fixed set of fields, never a whole row. */
export async function apiListClients(agencyId: string, p: ApiPage) {
  const where = { agencyId, deletedAt: null };
  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      select: { id: true, name: true, website: true, status: true, createdAt: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: p.perPage,
      skip: skipOf(p),
    }),
    db.client.count({ where }),
  ]);
  return { rows, total };
}

export async function apiListProjects(agencyId: string, p: ApiPage, clientId?: string) {
  const where = { agencyId, deletedAt: null, ...(clientId ? { clientId } : {}) };
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      select: {
        id: true,
        clientId: true,
        name: true,
        domain: true,
        locationCode: true,
        languageCode: true,
        device: true,
        createdAt: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: p.perPage,
      skip: skipOf(p),
    }),
    db.project.count({ where }),
  ]);
  return { rows, total };
}

export async function apiListRankings(agencyId: string, projectId: string, p: ApiPage) {
  const project = await db.project.findFirst({
    where: { id: projectId, agencyId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw new NotFoundError("Project not found.");
  const where = { agencyId, projectId };
  const [rows, total] = await Promise.all([
    db.keyword.findMany({
      where,
      select: {
        id: true,
        phrase: true,
        tags: true,
        currentPosition: true,
        currentUrl: true,
        bestPosition: true,
        changeDay: true,
        changeWeek: true,
        changeMonth: true,
        lastCheckedOn: true,
      },
      orderBy: [{ phrase: "asc" }, { id: "asc" }],
      take: p.perPage,
      skip: skipOf(p),
    }),
    db.keyword.count({ where }),
  ]);
  return { rows, total };
}

export async function apiListAlerts(agencyId: string, p: ApiPage, unreadOnly: boolean) {
  const where = { agencyId, ...(unreadOnly ? { readAt: null } : {}) };
  const [rows, total] = await Promise.all([
    db.alert.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        type: true,
        severity: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: p.perPage,
      skip: skipOf(p),
    }),
    db.alert.count({ where }),
  ]);
  return { rows, total };
}
