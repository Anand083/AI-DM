import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getEnv } from "@/env";
import { slugProblem } from "@/lib/slug";
import { db } from "@/server/db/client";
import type { TenantContext } from "@/server/auth/tenant-context";
import { can } from "@/server/auth/permissions";
import { SOFT_DELETE_DAYS } from "@/server/jobs/system/purge";
import { logActivity } from "./activity";
import { sendBillingNoticeEmail } from "./email";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";

export const TRIAL_DAYS = 14;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const createAgencySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(80, "Use 80 characters or fewer."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((value, ctx) => {
      const problem = slugProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  timezone: z.string().refine(isTimeZone, "Choose a valid time zone."),
});

export type CreateAgencyInput = z.infer<typeof createAgencySchema>;

export const updateAgencySchema = z.object({
  name: createAgencySchema.shape.name,
  timezone: createAgencySchema.shape.timezone,
  alertDropPositions: z.coerce.number().int().min(1, "Use at least 1.").max(50, "Use 50 or less."),
  alertDropWithin: z.coerce.number().int().min(1, "Use at least 1.").max(100, "Use 100 or less."),
  alertTopPosition: z.coerce.number().int().min(1, "Use at least 1.").max(100, "Use 100 or less."),
  alertOnCriticalAudit: z.boolean(),
  dailyDigest: z.boolean(),
});

/**
 * Creates an agency for a signed-in user. The user becomes OWNER and a 14 day trial of the
 * STARTER plan starts (mock billing).
 */
export async function createAgency(userId: string, rawInput: unknown) {
  const parsed = createAgencySchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    throw new ValidationError("Please check the form.", fieldErrors);
  }
  const input = parsed.data;

  const plan = await db.plan.findUnique({ where: { code: "STARTER" } });
  if (!plan) throw new Error("STARTER plan is missing. Run the seed.");

  try {
    return await db.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: { name: input.name, slug: input.slug, timezone: input.timezone },
      });
      await tx.agencyMember.create({ data: { agencyId: agency.id, userId, role: "OWNER" } });
      await tx.subscription.create({
        data: {
          agencyId: agency.id,
          planId: plan.id,
          status: "TRIALING",
          provider: "MOCK",
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
        },
      });
      await logActivity(
        {
          agencyId: agency.id,
          actorUserId: userId,
          action: "agency.created",
          targetType: "Agency",
          targetId: agency.id,
        },
        tx,
      );
      return agency;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationError("This address is already taken.", {
        slug: "This address is already taken.",
      });
    }
    throw error;
  }
}

/** True when no agency uses this slug yet. Used for live checks in the onboarding form. */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  if (slugProblem(slug)) return false;
  return (await db.agency.count({ where: { slug } })) === 0;
}

export async function getAgency(ctx: TenantContext) {
  const agency = await db.agency.findFirst({
    where: { id: ctx.agencyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      status: true,
      alertDropPositions: true,
      alertDropWithin: true,
      alertTopPosition: true,
      alertOnCriticalAudit: true,
      dailyDigest: true,
    },
  });
  if (!agency) throw new NotFoundError();
  return agency;
}

export async function updateAgencySettings(ctx: TenantContext, rawInput: unknown) {
  if (!can(ctx.role, "branding.edit")) throw new ForbiddenError();
  const parsed = updateAgencySchema.safeParse(rawInput);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");
  const agency = await db.agency.update({
    where: { id: ctx.agencyId },
    data: parsed.data,
    select: { id: true, name: true, slug: true, timezone: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "agency.updated",
    targetType: "Agency",
    targetId: ctx.agencyId,
  });
  return agency;
}

export const deleteAgencySchema = z.object({
  confirmName: z.string().trim().min(1, "Type the agency name to confirm.").max(200),
});

/**
 * Deletes the agency: owner only, and only after typing its exact name. It is a soft delete: the
 * agency disappears for everyone straight away, shared links and the custom domain stop working,
 * and the daily clean-up removes the data for good after 30 days.
 */
export async function deleteAgency(ctx: TenantContext, rawInput: unknown, now = new Date()) {
  if (!can(ctx.role, "agency.manage")) throw new ForbiddenError();
  const parsed = deleteAgencySchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Type the agency name to confirm.",
    );
  }
  const agency = await db.agency.findFirst({
    where: { id: ctx.agencyId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!agency) throw new NotFoundError();
  if (parsed.data.confirmName !== agency.name) {
    throw new ValidationError("The name does not match. Type the agency name exactly.", {
      confirmName: "The name does not match. Type the agency name exactly.",
    });
  }
  const owners = await db.agencyMember.findMany({
    where: { agencyId: agency.id, role: "OWNER" },
    select: { user: { select: { email: true } } },
    take: 20,
  });
  await db.$transaction(async (tx) => {
    await tx.agency.update({
      where: { id: agency.id },
      data: { deletedAt: now, status: "DELETED" },
    });
    await tx.subscription.updateMany({
      where: { agencyId: agency.id },
      data: { status: "CANCELED", cancelAtPeriodEnd: false, graceEndsAt: null },
    });
    await tx.report.updateMany({
      where: { agencyId: agency.id },
      data: { shareToken: null, shareExpiresAt: null },
    });
    await tx.reportSchedule.updateMany({
      where: { agencyId: agency.id },
      data: { enabled: false },
    });
    await tx.branding.updateMany({
      where: { agencyId: agency.id },
      data: { customDomain: null, customDomainStatus: "NONE", domainVerifyToken: null },
    });
    await logActivity(
      {
        agencyId: agency.id,
        actorUserId: ctx.userId,
        action: "agency.deleted",
        targetType: "Agency",
        targetId: agency.id,
      },
      tx,
    );
  });
  const purgeOn = new Date(now.getTime() + SOFT_DELETE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const owner of owners) {
    await sendBillingNoticeEmail(
      owner.user.email,
      `${agency.name} was deleted`,
      {
        preview: `${agency.name} was deleted`,
        heading: "Your agency was deleted",
        paragraphs: [
          `${agency.name} was deleted. Nobody on your team can open it any more, and shared report links stopped working.`,
          `Your data is removed for good on ${purgeOn}. If this was a mistake, contact support before then.`,
        ],
        actionLabel: "Open the app",
        url: getEnv().APP_URL,
      },
      `agency_deleted_${agency.id}_${owner.user.email}`,
    );
  }
}
