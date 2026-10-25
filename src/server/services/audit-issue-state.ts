import "server-only";
import { z } from "zod";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { getAudit } from "./audits";
import { ForbiddenError } from "./errors";
import { parseInput } from "./validation";

/** The most pages one bulk change touches. */
export const MAX_BULK = 2000;

export const issueStateSchema = z.object({
  auditId: z.string().min(1).max(100),
  code: z.string().min(1).max(100),
  /** OPEN puts the issue back on the list. */
  status: z.enum(["OPEN", "IGNORED", "RESOLVED"]),
  note: z.string().trim().max(300).nullable().default(null),
  /** Leave out to change every page that has the issue in this audit. */
  urls: z.array(z.string().min(1).max(2000)).max(MAX_BULK).optional(),
});

/**
 * Marks an issue as ignored (will not fix) or resolved (fixed, the next audit confirms it), for
 * chosen pages or for every page that has it. OPEN removes the mark. Marks are kept per project,
 * so they carry over to the next audit. A resolved issue that is found again opens itself.
 */
export async function setIssueState(ctx: TenantContext, projectId: string, raw: unknown) {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(issueStateSchema, raw);
  await getAudit(ctx, projectId, input.auditId);
  const base = { agencyId: ctx.agencyId };

  let urls = input.urls;
  if (!urls) {
    const rows = await db.auditIssue.findMany({
      where: { ...base, auditId: input.auditId, code: input.code },
      select: { url: true },
      orderBy: { url: "asc" },
      take: MAX_BULK,
    });
    urls = rows.map((r) => r.url);
  } else {
    // Only addresses that really have this issue in this audit can be marked.
    const rows = await db.auditIssue.findMany({
      where: { ...base, auditId: input.auditId, code: input.code, url: { in: urls } },
      select: { url: true },
      take: MAX_BULK,
    });
    urls = rows.map((r) => r.url);
  }
  if (urls.length === 0) return { changed: 0 };

  if (input.status === "OPEN") {
    const removed = await db.auditIssueState.deleteMany({
      where: { ...base, projectId, code: input.code, url: { in: urls } },
    });
    await log(ctx, projectId, input.code, "OPEN", removed.count);
    return { changed: removed.count };
  }

  // Replace marks one by one so the note and the status are always the newest.
  await db.auditIssueState.deleteMany({
    where: { ...base, projectId, code: input.code, url: { in: urls } },
  });
  await db.auditIssueState.createMany({
    data: urls.map((url) => ({
      agencyId: ctx.agencyId,
      projectId,
      code: input.code,
      url,
      status: input.status,
      note: input.note,
      updatedById: ctx.userId,
    })),
    skipDuplicates: true,
  });
  await log(ctx, projectId, input.code, input.status, urls.length);
  return { changed: urls.length };
}

async function log(
  ctx: TenantContext,
  projectId: string,
  code: string,
  status: string,
  count: number,
) {
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "audit.issue-marked",
    targetType: "Project",
    targetId: projectId,
    metadata: { code, status, count },
  });
}

/** Marks for the issues of one audit: how many pages of each code are ignored or resolved. */
export async function loadIssueStateCounts(agencyId: string, projectId: string, auditId: string) {
  const issues = await db.auditIssue.findMany({
    where: { agencyId, auditId },
    select: { code: true, url: true },
    take: 20_000,
  });
  if (issues.length === 0) return new Map<string, { ignored: number; resolved: number }>();
  const states = await db.auditIssueState.findMany({
    where: { agencyId, projectId },
    select: { code: true, url: true, status: true },
    take: 20_000,
  });
  const marked = new Map(states.map((s) => [`${s.code}\u0000${s.url}`, s.status]));
  const out = new Map<string, { ignored: number; resolved: number }>();
  for (const i of issues) {
    const status = marked.get(`${i.code}\u0000${i.url}`);
    if (!status) continue;
    const entry = out.get(i.code) ?? { ignored: 0, resolved: 0 };
    if (status === "IGNORED") entry.ignored++;
    else entry.resolved++;
    out.set(i.code, entry);
  }
  return out;
}

/** The marks of some pages for one issue code. */
export async function loadUrlStates(
  agencyId: string,
  projectId: string,
  code: string,
  urls: string[],
) {
  if (urls.length === 0) return new Map<string, { status: string; note: string | null }>();
  const rows = await db.auditIssueState.findMany({
    where: { agencyId, projectId, code, url: { in: urls } },
    select: { url: true, status: true, note: true },
    take: urls.length,
  });
  return new Map(rows.map((r) => [r.url, { status: r.status, note: r.note }]));
}
