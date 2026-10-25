import { countBySeverity, healthScore } from "@/lib/audit-math";
import { LEAD_AUDIT_PAGES, topIssues, type LeadIssue } from "@/lib/lead-widget";
import { issueInfo } from "@/server/audit/issue-catalog";
import type { Db } from "@/server/db/client";
import type { AuditResult, AuditStatus } from "@/server/providers/seo/types";
import { AppError } from "./errors";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type LeadGateway = {
  startAudit(
    caller: GatewayCaller,
    input: { domain: string; maxPages: number },
  ): Promise<{ taskId: string }>;
  getAuditStatus(taskId: string): Promise<AuditStatus>;
  getLeadAuditResult(caller: GatewayCaller, taskId: string): Promise<GatewayResult<AuditResult>>;
};

export type LeadRunnerDeps = {
  db: Db;
  gateway: LeadGateway;
  enqueuePoll: (data: { leadId: string; agencyId: string; attempt: number }) => Promise<void>;
  /** Tells the agency's team about a finished lead. Failing here must not lose the lead. */
  notify: (lead: { id: string; agencyId: string }) => Promise<void>;
  now?: () => Date;
  /** Progress checks before giving up. The default is 10 minutes at one check every 5 seconds. */
  maxPolls?: number;
};

export const LEAD_MAX_POLLS = 120;
/** What a visitor is told when something goes wrong. It never explains the cause. */
export const LEAD_FAILED_MESSAGE =
  "We could not check this website right now. Please check the address and try again later.";

async function failLead(deps: LeadRunnerDeps, agencyId: string, leadId: string, reason: string) {
  await deps.db.lead.updateMany({
    where: { id: leadId, agencyId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "FAILED",
      error: reason.slice(0, 300),
      finishedAt: (deps.now ?? (() => new Date()))(),
    },
  });
}

/** Step 1: asks the provider to crawl a few pages, then schedules the first progress check. */
export async function runLeadStart(
  deps: LeadRunnerDeps,
  input: { leadId: string; agencyId: string },
): Promise<"started" | "skipped" | "failed"> {
  const lead = await deps.db.lead.findFirst({
    where: { id: input.leadId, agencyId: input.agencyId },
    select: { id: true, status: true, domain: true },
  });
  if (!lead || lead.status !== "QUEUED") return "skipped";
  try {
    const { taskId } = await deps.gateway.startAudit(
      { agencyId: input.agencyId },
      { domain: lead.domain, maxPages: LEAD_AUDIT_PAGES },
    );
    await deps.db.lead.updateMany({
      where: { id: lead.id, agencyId: input.agencyId },
      data: { status: "RUNNING", providerTaskId: taskId },
    });
  } catch (error) {
    if (error instanceof AppError) {
      await failLead(deps, input.agencyId, lead.id, error.message);
      return "failed";
    }
    throw error;
  }
  await deps.enqueuePoll({ leadId: lead.id, agencyId: input.agencyId, attempt: 1 });
  return "started";
}

/** Step 2 (repeated): when the crawl is done, keep the score and the top issues and tell the agency. */
export async function pollLead(
  deps: LeadRunnerDeps,
  input: { leadId: string; agencyId: string; attempt: number },
): Promise<"running" | "done" | "failed" | "skipped"> {
  const { db, gateway } = deps;
  const lead = await db.lead.findFirst({
    where: { id: input.leadId, agencyId: input.agencyId },
    select: { id: true, status: true, providerTaskId: true },
  });
  if (!lead || lead.status !== "RUNNING" || !lead.providerTaskId) return "skipped";

  const status = await gateway.getAuditStatus(lead.providerTaskId);
  if (status.status === "failed") {
    await failLead(deps, input.agencyId, lead.id, status.error ?? "The audit failed.");
    return "failed";
  }
  if (status.status !== "completed") {
    if (input.attempt >= (deps.maxPolls ?? LEAD_MAX_POLLS)) {
      await failLead(deps, input.agencyId, lead.id, "The audit took too long.");
      return "failed";
    }
    await deps.enqueuePoll({
      leadId: lead.id,
      agencyId: input.agencyId,
      attempt: input.attempt + 1,
    });
    return "running";
  }

  let result: AuditResult;
  try {
    result = (await gateway.getLeadAuditResult({ agencyId: input.agencyId }, lead.providerTaskId))
      .data;
  } catch (error) {
    // Plan limit or budget pause: the visitor gets the neutral message, the agency sees the cause.
    if (error instanceof AppError) {
      await failLead(deps, input.agencyId, lead.id, error.message);
      return "failed";
    }
    throw error;
  }
  const issues: LeadIssue[] = topIssues(result.issues, (code) => {
    const info = issueInfo(code);
    return { title: info.title, severity: info.severity, fix: info.fix };
  });
  const score = healthScore(countBySeverity(result.issues), result.pagesCrawled);
  await db.lead.updateMany({
    where: { id: lead.id, agencyId: input.agencyId },
    data: {
      status: "DONE",
      healthScore: score,
      pagesCrawled: result.pagesCrawled,
      issues: issues as unknown as object,
      finishedAt: (deps.now ?? (() => new Date()))(),
    },
  });
  try {
    await deps.notify({ id: lead.id, agencyId: input.agencyId });
  } catch {
    // The lead is saved and shows on the Leads page even if the email could not be queued.
  }
  return "done";
}
