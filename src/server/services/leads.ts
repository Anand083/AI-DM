import "server-only";
import { z } from "zod";
import { emailSchema } from "@/lib/auth-schemas";
import { normalizeDomain } from "@/lib/domain";
import type { LeadIssue } from "@/lib/lead-widget";
import { getEnv } from "@/env";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db, rawDb } from "@/server/db/client";
import { enqueueLeadRun } from "@/server/jobs/enqueue";
import { logActivity } from "./activity";
import { sendLeadNoticeEmail } from "./email";
import { ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";
import { assertWithinLimit, getAgencyPlan } from "./usage";

/** The most leads one agency's widget accepts in a day, whatever the plan allows. */
export const MAX_LEADS_PER_DAY = 100;
/** The same visitor asking for the same website again within this time gets the earlier result. */
const REUSE_HOURS = 24;
/** What a visitor is told when the widget cannot take the request. It never explains why. */
export const WIDGET_BUSY_MESSAGE =
  "This free check is not available right now. Please try again later.";

export const leadFormSchema = z.object({
  website: z.string().trim().min(1, "Enter the website you want checked.").max(300),
  email: emailSchema,
  /** A hidden field. People leave it empty; many bots fill it in. */
  company: z.string().max(200).optional(),
});

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

/**
 * Takes a request from the public widget: checks the form, the plan and the daily limit, saves the
 * lead and queues the mini audit. The caller limits requests by IP address. A filled-in hidden
 * field means a bot: nothing is saved and `publicId` is null.
 */
export async function submitLead(
  agencySlug: string,
  rawInput: unknown,
  options: { now?: Date; enqueue?: typeof enqueueLeadRun } = {},
): Promise<{ publicId: string | null }> {
  const parsed = leadFormSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    throw new ValidationError("Please check the form.", fieldErrors);
  }
  const input = parsed.data;
  if (input.company && input.company.trim() !== "") return { publicId: null };
  const domain = normalizeDomain(input.website);
  if (!domain) {
    throw new ValidationError("Enter a website like example.com.", {
      website: "Enter a website like example.com.",
    });
  }

  const agency = await rawDb.agency.findFirst({
    where: { slug: agencySlug, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!agency) throw new NotFoundError("This form is not available.");
  const now = options.now ?? new Date();
  const ref = { agencyId: agency.id };

  // The visitor never learns about plans or limits.
  try {
    const plan = await getAgencyPlan(ref, now);
    if (plan.status === "EXPIRED" || plan.status === "CANCELED") {
      throw new LimitExceededError(WIDGET_BUSY_MESSAGE);
    }
    await assertWithinLimit(ref, "LEAD_AUDIT", 1, now);
  } catch (error) {
    if (error instanceof LimitExceededError) throw new LimitExceededError(WIDGET_BUSY_MESSAGE);
    throw error;
  }
  const today = await db.lead.count({
    where: { agencyId: agency.id, createdAt: { gt: new Date(now.getTime() - 86_400_000) } },
  });
  if (today >= MAX_LEADS_PER_DAY) throw new LimitExceededError(WIDGET_BUSY_MESSAGE);

  const email = input.email.toLowerCase();
  const earlier = await db.lead.findFirst({
    where: {
      agencyId: agency.id,
      domain,
      email,
      status: { not: "FAILED" },
      createdAt: { gt: new Date(now.getTime() - REUSE_HOURS * 3_600_000) },
    },
    select: { publicId: true },
    orderBy: { createdAt: "desc" },
  });
  if (earlier) return { publicId: earlier.publicId };

  const lead = await db.lead.create({
    data: { agencyId: agency.id, domain, email, createdAt: now },
    select: { id: true, publicId: true },
  });
  await (options.enqueue ?? enqueueLeadRun)({ leadId: lead.id, agencyId: agency.id });
  return { publicId: lead.publicId };
}

export type LeadStatusView =
  | { status: "QUEUED" | "RUNNING" }
  | { status: "FAILED"; message: string }
  | { status: "DONE"; healthScore: number; pagesCrawled: number; issues: LeadIssue[] };

/**
 * What the widget shows a visitor. The long random id is the only key. It returns the result
 * and nothing else: no email, no agency data. Unknown ids give null.
 */
export async function getLeadStatus(publicId: string): Promise<LeadStatusView | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(publicId)) return null;
  const lead = await rawDb.lead.findUnique({
    where: { publicId },
    select: { status: true, healthScore: true, pagesCrawled: true, issues: true },
  });
  if (!lead) return null;
  if (lead.status === "DONE" && lead.healthScore !== null) {
    return {
      status: "DONE",
      healthScore: lead.healthScore,
      pagesCrawled: lead.pagesCrawled ?? 0,
      issues: (lead.issues ?? []) as unknown as LeadIssue[],
    };
  }
  if (lead.status === "FAILED") {
    return {
      status: "FAILED",
      message:
        "We could not check this website right now. Please check the address and try again later.",
    };
  }
  return { status: lead.status === "RUNNING" ? "RUNNING" : "QUEUED" };
}

export async function listLeads(ctx: TenantContext, p: Page = {}) {
  requireView(ctx);
  const { take, skip } = paging({ pageSize: 20, ...p });
  const where = { agencyId: ctx.agencyId };
  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      select: {
        id: true,
        domain: true,
        email: true,
        status: true,
        healthScore: true,
        pagesCrawled: true,
        issues: true,
        error: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.lead.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, issues: (r.issues ?? []) as unknown as LeadIssue[] })),
    total,
  };
}

/** Deletes a lead on request of the agency (for example when the visitor asks to be forgotten). */
export async function deleteLead(ctx: TenantContext, leadId: string): Promise<void> {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  const result = await db.lead.deleteMany({ where: { id: leadId, agencyId: ctx.agencyId } });
  if (result.count === 0) throw new NotFoundError("Lead not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "lead.deleted",
    targetType: "Lead",
    targetId: leadId,
  });
}

/** Emails the owners and admins of the agency about a finished lead. Queued once per person. */
export async function notifyAgencyOfLead(lead: { id: string; agencyId: string }): Promise<void> {
  const row = await db.lead.findFirst({
    where: { id: lead.id, agencyId: lead.agencyId },
    select: {
      domain: true,
      email: true,
      healthScore: true,
      pagesCrawled: true,
      issues: true,
      agency: { select: { slug: true } },
    },
  });
  if (!row || row.healthScore === null) return;
  const members = await db.agencyMember.findMany({
    where: { agencyId: lead.agencyId, role: { in: ["OWNER", "ADMIN"] } },
    select: { user: { select: { email: true } } },
    take: 20,
  });
  const issues = (row.issues ?? []) as unknown as LeadIssue[];
  const url = `${getEnv().APP_URL.replace(/\/$/, "")}/app/${row.agency.slug}/leads`;
  for (const member of members) {
    await sendLeadNoticeEmail(
      member.user.email,
      `New lead: ${row.email} (${row.domain})`,
      {
        preview: `${row.email} asked for a free check of ${row.domain}`,
        heading: "You have a new lead",
        paragraphs: [
          `${row.email} asked for a free check of ${row.domain} on your website.`,
          `Health score: ${row.healthScore} out of 100 (${row.pagesCrawled ?? 0} pages checked).`,
          issues.length > 0
            ? `Main problems: ${issues.map((i) => i.title).join("; ")}.`
            : "No problems were found on the pages checked.",
        ],
        actionLabel: "Open your leads",
        url,
      },
      `lead_${lead.id}_${member.user.email}`,
    );
  }
  await db.lead.updateMany({
    where: { id: lead.id, agencyId: lead.agencyId },
    data: { notifiedAt: new Date() },
  });
}
