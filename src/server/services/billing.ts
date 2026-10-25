import "server-only";
import { Prisma, type BillingInterval } from "@prisma/client";
import { createId } from "@paralleldrive/cuid2";
import { getEnv } from "@/env";
import {
  daysLeft,
  priceOf,
  transition,
  type BillingInput,
  type Effect,
  type Interval,
  type PlanPrice,
  type SubState,
} from "@/lib/billing-state";
import { UNLIMITED, type PlanLimits } from "@/lib/plan-limits";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db, rawDb } from "@/server/db/client";
import { getBillingProvider, getMockBilling } from "@/server/providers/billing";
import type { BillingWebhookEvent } from "@/server/providers/billing";
import { logger } from "@/server/logger";
import { logActivity } from "./activity";
import { sendBillingNoticeEmail } from "./email";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";

type Tx = Prisma.TransactionClient;

function requireBilling(ctx: TenantContext): void {
  if (!can(ctx.role, "billing.manage")) throw new ForbiddenError();
}

export async function loadPlans(client: Pick<Tx, "plan"> = rawDb): Promise<
  (PlanPrice & {
    id: string;
    name: string;
    isPublic: boolean;
    limits: PlanLimits;
    sortOrder: number;
  })[]
> {
  const rows = await client.plan.findMany({ orderBy: { sortOrder: "asc" }, take: 50 });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    isPublic: p.isPublic,
    priceMonthlyCents: p.priceMonthlyCents,
    priceYearlyCents: p.priceYearlyCents,
    sortOrder: p.sortOrder,
    limits: p.limits as unknown as PlanLimits,
  }));
}

type SubRow = Awaited<ReturnType<typeof loadSubscription>>;

async function loadSubscription(tx: Pick<Tx, "subscription">, agencyId: string) {
  const sub = await tx.subscription.findFirst({
    where: { agencyId },
    include: { plan: { select: { code: true } } },
  });
  if (!sub) throw new NotFoundError("No subscription found.");
  return sub;
}

function toState(sub: SubRow, planCodeById: Map<string, string>): SubState {
  return {
    status: sub.status,
    planCode: sub.plan.code,
    interval: sub.interval,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    graceEndsAt: sub.graceEndsAt,
    pendingPlanCode: sub.pendingPlanId ? (planCodeById.get(sub.pendingPlanId) ?? null) : null,
    pendingInterval: sub.pendingInterval,
  };
}

export class BillingRuleError extends ConflictError {}

export type ApplyResult = { changed: boolean; effects: Effect[]; state: SubState };

/**
 * Runs one input through the state machine and saves the result: the subscription row and the
 * invoices. Emails are queued after the save. Pass `tx` to make it part of a bigger transaction.
 * An input that the rules refuse throws a BillingRuleError with a plain message.
 */
export async function applyBillingInput(
  agencyId: string,
  input: BillingInput,
  now: Date,
  tx: Tx,
): Promise<ApplyResult> {
  const [sub, plans] = await Promise.all([loadSubscription(tx, agencyId), loadPlans(tx)]);
  const byId = new Map(plans.map((p) => [p.id, p.code]));
  const byCode = new Map(plans.map((p) => [p.code, p.id]));
  const out = transition(toState(sub, byId), input, now, plans);
  if (!out.ok) throw new BillingRuleError(out.error);
  if (!out.changed && out.effects.length === 0)
    return { changed: false, effects: [], state: out.state };

  const s = out.state;
  const planId = byCode.get(s.planCode);
  if (!planId) throw new Error(`Plan ${s.planCode} is missing.`);
  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      status: s.status,
      planId,
      interval: s.interval,
      trialEndsAt: s.trialEndsAt,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      graceEndsAt: s.graceEndsAt,
      pendingPlanId: s.pendingPlanCode ? (byCode.get(s.pendingPlanCode) ?? null) : null,
      pendingInterval: s.pendingInterval,
    },
  });
  for (const effect of out.effects) {
    if (effect.type !== "invoice") continue;
    const plan = plans.find((p) => p.code === effect.planCode)!;
    await tx.invoice.create({
      data: {
        agencyId,
        number: `INV-${createId().slice(0, 8).toUpperCase()}`,
        description: `${plan.name} plan, ${effect.interval === "YEAR" ? "yearly" : "monthly"}`,
        amountCents: effect.amountCents,
        status: effect.status,
        periodStart: effect.periodStart,
        periodEnd: effect.periodEnd,
      },
    });
  }
  return { changed: out.changed, effects: out.effects, state: s };
}

/** Emails the owners about something that happened. Repeats are stopped by the key. */
export async function notifyOwners(
  agencyId: string,
  effects: Effect[],
  keyPart: string,
): Promise<void> {
  const wanted = effects.filter(
    (e) => e.type === "payment_failed" || e.type === "expired" || e.type === "canceled",
  );
  if (wanted.length === 0) return;
  const agency = await rawDb.agency.findUnique({
    where: { id: agencyId },
    select: {
      name: true,
      slug: true,
      members: { where: { role: "OWNER" }, select: { user: { select: { email: true } } } },
    },
  });
  if (!agency) return;
  const url = `${getEnv().APP_URL}/app/${agency.slug}/billing`;
  for (const effect of wanted) {
    const text = (() => {
      switch (effect.type) {
        case "payment_failed":
          return {
            subject: `Payment failed for ${agency.name}`,
            heading: "We could not take your payment",
            paragraphs: [
              `Your latest payment for ${agency.name} did not go through. Everything keeps working until ${effect.graceEndsAt.toISOString().slice(0, 10)}.`,
              "After that your account becomes read-only: you can see your data but not start new checks.",
            ],
            actionLabel: "Fix payment",
          };
        case "expired":
          return {
            subject: `${agency.name} is now read-only`,
            heading:
              effect.reason === "trial" ? "Your free trial has ended" : "Your account is read-only",
            paragraphs: [
              "You can still see all your data, but new checks, audits and reports are paused.",
              "Choose a plan to start again. Nothing is deleted.",
            ],
            actionLabel: "Choose a plan",
          };
        default:
          return {
            subject: `Your ${agency.name} subscription has ended`,
            heading: "Your subscription has ended",
            paragraphs: [
              "You can still see your data, but new checks, audits and reports are paused.",
              "You can start again at any time.",
            ],
            actionLabel: "Choose a plan",
          };
      }
    })();
    for (const owner of agency.members) {
      await sendBillingNoticeEmail(
        owner.user.email,
        text.subject,
        {
          preview: text.subject,
          heading: text.heading,
          paragraphs: text.paragraphs,
          actionLabel: text.actionLabel,
          url,
        },
        `billing_${effect.type}_${agencyId}_${keyPart}_${owner.user.email}`,
      );
    }
  }
}

const webhookToInput = (event: BillingWebhookEvent): BillingInput => {
  switch (event.type) {
    case "checkout.completed":
      if (!event.planCode || !event.interval)
        throw new ValidationError("The checkout event has no plan.");
      return { type: "checkout.completed", planCode: event.planCode, interval: event.interval };
    case "payment.succeeded":
      return { type: "payment.succeeded" };
    case "payment.failed":
      return { type: "payment.failed" };
    case "subscription.canceled":
      return { type: "subscription.canceled" };
  }
};

export type WebhookResult = { status: "processed" | "duplicate" | "ignored" };

/**
 * Handles one verified provider event exactly once. The event record and the subscription change
 * are saved in one transaction, so a crash in the middle means a retry processes it again, and a
 * repeat of an event that finished is skipped.
 */
export async function processBillingEvent(
  event: BillingWebhookEvent,
  now = new Date(),
): Promise<WebhookResult> {
  const agency = await rawDb.agency.findUnique({
    where: { id: event.agencyId },
    select: { id: true },
  });
  let applied: ApplyResult | null = null;
  try {
    await rawDb.$transaction(async (tx) => {
      await tx.billingEvent.create({
        data: {
          eventId: event.id,
          provider: "MOCK",
          type: event.type,
          agencyId: agency?.id ?? null,
          payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
        },
      });
      if (!agency) return;
      try {
        applied = await applyBillingInput(agency.id, webhookToInput(event), now, tx);
      } catch (error) {
        // A rule refusing the event is not a reason to retry: keep the record and say why.
        if (!(error instanceof BillingRuleError)) throw error;
        await tx.billingEvent.update({
          where: { eventId: event.id },
          data: { error: error.message },
        });
        return;
      }
      await tx.billingEvent.update({ where: { eventId: event.id }, data: { processedAt: now } });
      if (event.checkoutId) {
        await tx.checkoutSession.updateMany({
          where: { id: event.checkoutId, agencyId: agency.id },
          data: { status: event.type === "payment.failed" ? "FAILED" : "COMPLETED" },
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "duplicate" };
    }
    throw error;
  }
  const result = applied as ApplyResult | null;
  if (!agency || !result) return { status: "ignored" };
  await notifyOwners(agency.id, result.effects, event.id);
  if (result.changed) {
    await logActivity({
      agencyId: agency.id,
      actorUserId: null,
      action: `billing.${event.type}`,
      targetType: "Subscription",
      targetId: agency.id,
    });
  }
  return { status: result.changed || result.effects.length > 0 ? "processed" : "ignored" };
}

/** Called by the webhook route. Throws BillingSignatureError for a bad signature. */
export async function handleBillingWebhook(
  rawBody: string,
  headers: Headers,
): Promise<WebhookResult> {
  const event = getBillingProvider().verifyAndParseWebhook(rawBody, headers);
  return processBillingEvent(event);
}

// ---------------------------------------------------------------------------
// What the billing page and its buttons use
// ---------------------------------------------------------------------------

export async function getBillingSummary(ctx: TenantContext, now = new Date()) {
  requireBilling(ctx);
  const [sub, plans] = await Promise.all([loadSubscription(rawDb, ctx.agencyId), loadPlans(rawDb)]);
  const byId = new Map(plans.map((p) => [p.id, p.code]));
  const state = toState(sub, byId);
  const current = plans.find((p) => p.code === state.planCode)!;
  return {
    state,
    planName: current.name,
    price: priceOf(plans, state.planCode, state.interval),
    trialDaysLeft: state.status === "TRIALING" ? daysLeft(state.trialEndsAt, now) : null,
    pendingPlanName: state.pendingPlanCode
      ? (plans.find((p) => p.code === state.pendingPlanCode)?.name ?? null)
      : null,
    plans: plans
      .filter((p) => p.isPublic || p.code === state.planCode)
      .map((p) => ({
        code: p.code,
        name: p.name,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        limits: p.limits,
      })),
  };
}

export async function listInvoices(ctx: TenantContext, p: Page = {}) {
  requireBilling(ctx);
  const { take, skip } = paging(p);
  const where = { agencyId: ctx.agencyId };
  const [items, total] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip,
    }),
    db.invoice.count({ where }),
  ]);
  return { items, total, page: Math.floor(skip / take) + 1, pageSize: take };
}

async function planOrThrow(planCode: string) {
  const plans = await loadPlans(rawDb);
  const plan = plans.find((p) => p.code === planCode && p.isPublic);
  if (!plan) throw new ValidationError("Choose one of the plans.");
  return { plan, plans };
}

export async function startCheckout(
  ctx: TenantContext,
  input: { planCode: string; interval: Interval },
) {
  requireBilling(ctx);
  await planOrThrow(input.planCode);
  const agency = await db.agency.findUniqueOrThrow({
    where: { id: ctx.agencyId },
    select: { slug: true },
  });
  const checkout = await getBillingProvider().createCheckout({
    agencyId: ctx.agencyId,
    agencySlug: agency.slug,
    planCode: input.planCode,
    interval: input.interval,
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "billing.checkout_started",
    targetType: "Subscription",
    targetId: ctx.agencyId,
    metadata: { planCode: input.planCode, interval: input.interval },
  });
  return checkout;
}

/** What the agency uses now, to compare with what a smaller plan allows. */
export async function currentUsageCounts(agencyId: string) {
  const [clients, projects, keywords, team, clientUsers] = await Promise.all([
    db.client.count({ where: { agencyId, deletedAt: null } }),
    db.project.count({ where: { agencyId, deletedAt: null } }),
    db.keyword.count({ where: { agencyId } }),
    db.agencyMember.count({ where: { agencyId } }),
    db.clientUser.count({ where: { agencyId } }),
  ]);
  return { clients, projects, keywords, team, clientUsers };
}

/** Plain-English reasons a plan is too small for what the agency has now. Empty means it fits. */
export function downgradeBlockers(
  usage: Awaited<ReturnType<typeof currentUsageCounts>>,
  limits: PlanLimits,
  planName: string,
): string[] {
  const rows: [number, number, string, string][] = [
    [usage.clients, limits.maxClients, "client", "clients"],
    [usage.projects, limits.maxProjects, "project", "projects"],
    [usage.keywords, limits.maxKeywords, "keyword", "keywords"],
    [usage.team, limits.maxTeamMembers, "team member", "team members"],
    [usage.clientUsers, limits.maxClientUsers, "client user", "client users"],
  ];
  return rows
    .filter(([used, limit]) => limit !== UNLIMITED && used > limit)
    .map(([used, limit, one, many]) => {
      const over = used - limit;
      return `You have ${used} ${used === 1 ? one : many}, but the ${planName} plan allows ${limit}. Remove ${over} to switch.`;
    });
}

export async function changePlan(
  ctx: TenantContext,
  input: { planCode: string; interval: Interval },
  now = new Date(),
) {
  requireBilling(ctx);
  const { plan, plans } = await planOrThrow(input.planCode);
  const sub = await loadSubscription(rawDb, ctx.agencyId);
  const current = plans.find((p) => p.id === sub.planId)!;
  // A smaller plan must fit what is already there.
  if (plan.priceMonthlyCents < current.priceMonthlyCents) {
    const blockers = downgradeBlockers(
      await currentUsageCounts(ctx.agencyId),
      plan.limits,
      plan.name,
    );
    if (blockers.length > 0) throw new ConflictError(blockers.join(" "));
  }
  const result = await rawDb.$transaction((tx) =>
    applyBillingInput(ctx.agencyId, { type: "change_plan", ...input }, now, tx),
  );
  await getBillingProvider().changePlan({ agencyId: ctx.agencyId, ...input });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "billing.plan_changed",
    targetType: "Subscription",
    targetId: ctx.agencyId,
    metadata: {
      planCode: input.planCode,
      interval: input.interval,
      scheduled: result.state.pendingPlanCode !== null,
    },
  });
  return { scheduled: result.state.pendingPlanCode !== null };
}

export async function cancelSubscription(ctx: TenantContext, now = new Date()) {
  requireBilling(ctx);
  await rawDb.$transaction((tx) => applyBillingInput(ctx.agencyId, { type: "cancel" }, now, tx));
  await getBillingProvider().cancel({ agencyId: ctx.agencyId });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "billing.cancel_requested",
    targetType: "Subscription",
    targetId: ctx.agencyId,
  });
}

export async function resumeSubscription(ctx: TenantContext, now = new Date()) {
  requireBilling(ctx);
  await rawDb.$transaction((tx) => applyBillingInput(ctx.agencyId, { type: "resume" }, now, tx));
  await getBillingProvider().resume({ agencyId: ctx.agencyId });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "billing.resumed",
    targetType: "Subscription",
    targetId: ctx.agencyId,
  });
}

/** The mock checkout page: details of an open checkout in this agency. */
export async function getMockCheckout(ctx: TenantContext, sessionId: string) {
  requireBilling(ctx);
  const session = await db.checkoutSession.findFirst({
    where: { id: sessionId, agencyId: ctx.agencyId },
  });
  if (!session) throw new NotFoundError("Checkout not found.");
  const plans = await loadPlans(rawDb);
  const plan = plans.find((p) => p.code === session.planCode);
  if (!plan) throw new NotFoundError("Checkout not found.");
  return {
    id: session.id,
    status: session.status,
    planName: plan.name,
    planCode: plan.code,
    interval: session.interval as Interval,
    amountCents: priceOf(plans, plan.code, session.interval as Interval),
  };
}

/**
 * The Pay and Fail buttons of the mock checkout. They send a signed webhook to our own webhook
 * route, like a real provider would. `post` is how the request is sent (tests pass their own).
 */
export async function completeMockCheckout(
  ctx: TenantContext,
  sessionId: string,
  outcome: "pay" | "fail",
  post: (url: string, body: string, signature: string) => Promise<Response> = defaultPost,
) {
  const checkout = await getMockCheckout(ctx, sessionId);
  if (checkout.status !== "OPEN") throw new ConflictError("This checkout was already finished.");
  const mock = getMockBilling();
  const { body, signature } = mock.signWebhook({
    id: `evt_${createId()}`,
    type: outcome === "pay" ? "checkout.completed" : "payment.failed",
    agencyId: ctx.agencyId,
    occurredAt: new Date(),
    planCode: checkout.planCode,
    interval: checkout.interval,
    checkoutId: checkout.id,
  });
  const response = await post(`${internalUrl()}/api/webhooks/billing`, body, signature);
  if (!response.ok) {
    logger.error({ status: response.status }, "mock billing webhook was refused");
    throw new ConflictError("The payment could not be recorded. Please try again.");
  }
  return { paid: outcome === "pay" };
}

export function internalUrl(): string {
  return process.env.INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

async function defaultPost(url: string, body: string, signature: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-billing-signature": signature },
    body,
    cache: "no-store",
  });
}

export type { BillingInterval };

export type SubscriptionNotice =
  | { kind: "trial"; daysLeft: number }
  | { kind: "past_due"; graceEndsAt: Date }
  | { kind: "read_only" }
  | null;

/** A short notice for the top of every page, for any team member. No notice for healthy accounts. */
export async function getSubscriptionNotice(
  ctx: TenantContext,
  now = new Date(),
): Promise<SubscriptionNotice> {
  const sub = await rawDb.subscription.findFirst({
    where: { agencyId: ctx.agencyId },
    select: { status: true, trialEndsAt: true, graceEndsAt: true },
  });
  if (!sub) return null;
  switch (sub.status) {
    case "TRIALING":
      return { kind: "trial", daysLeft: daysLeft(sub.trialEndsAt, now) };
    case "PAST_DUE":
      return sub.graceEndsAt ? { kind: "past_due", graceEndsAt: sub.graceEndsAt } : null;
    case "EXPIRED":
    case "CANCELED":
      return { kind: "read_only" };
    default:
      return null;
  }
}
