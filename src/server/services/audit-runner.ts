import type { Prisma } from "@prisma/client";
import { buildAuditAlert } from "@/lib/alert-rules";
import { compareIssues, countBySeverity, healthScore } from "@/lib/audit-math";
import { createAlerts, loadAlertSettings } from "./alert-store";
import type { Db } from "@/server/db/client";
import type { AuditResult, AuditStatus } from "@/server/providers/seo/types";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

/** What the worker needs from the SEO gateway. */
export type AuditGateway = {
  startAudit(
    caller: GatewayCaller,
    input: { domain: string; maxPages: number },
  ): Promise<{ taskId: string }>;
  getAuditStatus(taskId: string): Promise<AuditStatus>;
  getAuditResult(caller: GatewayCaller, taskId: string): Promise<GatewayResult<AuditResult>>;
};

export type RunnerDeps = {
  db: Db;
  gateway: AuditGateway;
  /** Queues the next progress check. */
  enqueuePoll: (data: { auditId: string; agencyId: string; attempt: number }) => Promise<void>;
  now?: () => Date;
};

/** The audit is given up on after this many progress checks (10 seconds apart): 1 hour. */
export const MAX_POLLS = 360;
const CHUNK = 1000;
export const MAX_STORED_ISSUES = 20_000;

export async function failAudit(
  db: Db,
  agencyId: string,
  auditId: string,
  message: string,
  now = new Date(),
) {
  await db.audit.updateMany({
    where: { id: auditId, agencyId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", error: message, finishedAt: now },
  });
}

/** Step 1: ask the provider to start crawling, then schedule the first progress check. */
export async function runAuditStart(
  deps: RunnerDeps,
  input: { auditId: string; agencyId: string },
): Promise<"started" | "skipped"> {
  const audit = await deps.db.audit.findFirst({
    where: { id: input.auditId, agencyId: input.agencyId },
    select: {
      id: true,
      status: true,
      maxPages: true,
      projectId: true,
      project: { select: { domain: true } },
    },
  });
  if (!audit || audit.status !== "QUEUED") return "skipped";

  const { taskId } = await deps.gateway.startAudit(
    { agencyId: input.agencyId, projectId: audit.projectId },
    { domain: audit.project.domain, maxPages: audit.maxPages },
  );
  await deps.db.audit.update({
    where: { id: audit.id, agencyId: input.agencyId },
    data: {
      status: "RUNNING",
      providerTaskId: taskId,
      startedAt: (deps.now ?? (() => new Date()))(),
      progress: 0,
    },
  });
  await deps.enqueuePoll({ auditId: audit.id, agencyId: input.agencyId, attempt: 1 });
  return "started";
}

/** Step 2 (repeated every 10 seconds): update progress; when done, save the results. */
export async function pollAudit(
  deps: RunnerDeps,
  input: { auditId: string; agencyId: string; attempt: number },
): Promise<"running" | "completed" | "failed" | "skipped"> {
  const { db, gateway } = deps;
  const now = deps.now ?? (() => new Date());
  const audit = await db.audit.findFirst({
    where: { id: input.auditId, agencyId: input.agencyId },
    select: {
      id: true,
      status: true,
      providerTaskId: true,
      projectId: true,
      createdAt: true,
      project: { select: { name: true } },
    },
  });
  if (!audit || audit.status !== "RUNNING" || !audit.providerTaskId) return "skipped";

  const status = await gateway.getAuditStatus(audit.providerTaskId);

  if (status.status === "failed") {
    await failAudit(
      db,
      input.agencyId,
      audit.id,
      status.error ?? "The audit could not be completed.",
      now(),
    );
    return "failed";
  }

  if (status.status !== "completed") {
    await db.audit.update({
      where: { id: audit.id, agencyId: input.agencyId },
      data: { progress: Math.min(99, status.progress) },
    });
    if (input.attempt >= MAX_POLLS) {
      await failAudit(
        db,
        input.agencyId,
        audit.id,
        "The audit took too long and was stopped. Please try again.",
        now(),
      );
      return "failed";
    }
    await deps.enqueuePoll({
      auditId: audit.id,
      agencyId: input.agencyId,
      attempt: input.attempt + 1,
    });
    return "running";
  }

  const { data: result } = await gateway.getAuditResult(
    { agencyId: input.agencyId, projectId: audit.projectId },
    audit.providerTaskId,
  );
  const issues = result.issues.slice(0, MAX_STORED_ISSUES);
  const severity = countBySeverity(issues);
  const byCode: Record<string, number> = {};
  for (const i of issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;

  // A retry must not double the data, so start from a clean slate.
  await db.$transaction(async (tx) => {
    await tx.auditPage.deleteMany({ where: { agencyId: input.agencyId, auditId: audit.id } });
    await tx.auditIssue.deleteMany({ where: { agencyId: input.agencyId, auditId: audit.id } });
    for (let i = 0; i < result.pages.length; i += CHUNK) {
      await tx.auditPage.createMany({
        data: result.pages.slice(i, i + CHUNK).map((p) => ({
          agencyId: input.agencyId,
          auditId: audit.id,
          url: p.url,
          statusCode: p.statusCode,
          title: p.title,
          loadTimeMs: p.loadTimeMs,
          wordCount: p.wordCount,
          issueCount: p.issueCount,
        })),
      });
    }
    for (let i = 0; i < issues.length; i += CHUNK) {
      await tx.auditIssue.createMany({
        data: issues.slice(i, i + CHUNK).map((issue) => ({
          agencyId: input.agencyId,
          auditId: audit.id,
          code: issue.code,
          severity: issue.severity,
          url: issue.url,
          details: (issue.details ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
    }
    await tx.audit.update({
      where: { id: audit.id, agencyId: input.agencyId },
      data: {
        status: "COMPLETED",
        progress: 100,
        pagesCrawled: result.pagesCrawled,
        healthScore: healthScore(severity, result.pagesCrawled),
        counts: { ...severity, byCode },
        finishedAt: now(),
        error: null,
      },
    });
  });

  await raiseAuditAlert(db, input.agencyId, audit, issues);
  return "completed";
}

/** An alert for critical issues that the audit before did not have (or any critical issue in a first audit). */
async function raiseAuditAlert(
  db: Db,
  agencyId: string,
  audit: { id: string; projectId: string; createdAt: Date; project: { name: string } },
  issues: { code: string; url: string; severity: string }[],
) {
  const critical = issues.filter((i) => i.severity === "CRITICAL");
  if (critical.length === 0) return;
  const previous = await db.audit.findFirst({
    where: {
      agencyId,
      projectId: audit.projectId,
      status: "COMPLETED",
      createdAt: { lt: audit.createdAt },
      id: { not: audit.id },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  let newCritical = critical.length;
  if (previous) {
    const before = await db.auditIssue.findMany({
      where: { agencyId, auditId: previous.id, severity: "CRITICAL" },
      select: { code: true, url: true },
      take: 20_000,
    });
    newCritical = compareIssues(before, critical).new;
  }
  const draft = buildAuditAlert({
    auditId: audit.id,
    projectId: audit.projectId,
    projectName: audit.project.name,
    newCritical,
    firstAudit: !previous,
    settings: await loadAlertSettings(db, agencyId),
  });
  if (draft) await createAlerts(db, agencyId, [draft]);
}
