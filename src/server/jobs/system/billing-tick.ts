import type { PrismaClient } from "@prisma/client";
import { daysLeft } from "@/lib/billing-state";
import { getEnv } from "@/env";
import { logger } from "@/server/logger";
import { applyBillingInput, notifyOwners } from "@/server/services/billing";
import { sendBillingNoticeEmail } from "@/server/services/email";

export type BillingTickDeps = {
  /** System-wide: looks at every agency's subscription, so it uses the plain client. */
  db: PrismaClient;
  now: Date;
  batchSize?: number;
};

export type BillingTickResult = {
  checked: number;
  expired: number;
  canceled: number;
  renewed: number;
  failed: number;
  reminders: number;
};

/**
 * The time part of billing, run by the 15 minute tick: trials that ended, unpaid accounts whose
 * grace period is over, periods that ended (cancel, or renew with the mock provider), and the
 * 3 day and 1 day trial reminders. Safe to run often: each step only acts on what is due.
 */
export async function runBillingTick(deps: BillingTickDeps): Promise<BillingTickResult> {
  const { db, now } = deps;
  const batchSize = deps.batchSize ?? 200;
  const result: BillingTickResult = {
    checked: 0,
    expired: 0,
    canceled: 0,
    renewed: 0,
    failed: 0,
    reminders: 0,
  };

  const due = await db.subscription.findMany({
    where: {
      OR: [
        { status: "TRIALING", trialEndsAt: { lte: now } },
        { status: "PAST_DUE", graceEndsAt: { lte: now } },
        { status: "ACTIVE", currentPeriodEnd: { lte: now } },
      ],
    },
    select: { agencyId: true, provider: true, providerMeta: true },
    orderBy: { currentPeriodEnd: "asc" },
    take: batchSize,
  });

  for (const sub of due) {
    result.checked++;
    try {
      const tick = await db.$transaction((tx) =>
        applyBillingInput(sub.agencyId, { type: "tick" }, now, tx),
      );
      let effects = tick.effects;
      if (effects.some((e) => e.type === "renewal_due") && sub.provider === "MOCK") {
        // The mock provider "charges the saved card": it works unless a test asked for a failure.
        const fails = (sub.providerMeta as { failRenewal?: boolean } | null)?.failRenewal === true;
        const paid = await db.$transaction((tx) =>
          applyBillingInput(
            sub.agencyId,
            { type: fails ? "payment.failed" : "payment.succeeded" },
            now,
            tx,
          ),
        );
        effects = paid.effects;
        if (fails) result.failed++;
        else result.renewed++;
      }
      if (effects.some((e) => e.type === "expired")) result.expired++;
      if (effects.some((e) => e.type === "canceled")) result.canceled++;
      await notifyOwners(sub.agencyId, effects, `${now.toISOString().slice(0, 10)}`);
    } catch (error) {
      logger.error({ err: error, agencyId: sub.agencyId }, "billing tick failed for an agency");
    }
  }

  result.reminders = await sendTrialReminders(db, now, batchSize);
  return result;
}

async function sendTrialReminders(db: PrismaClient, now: Date, take: number): Promise<number> {
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const trials = await db.subscription.findMany({
    where: { status: "TRIALING", trialEndsAt: { gt: now, lte: soon } },
    select: {
      id: true,
      agencyId: true,
      trialEndsAt: true,
      trialReminder3At: true,
      trialReminder1At: true,
      agency: {
        select: {
          name: true,
          slug: true,
          members: { where: { role: "OWNER" }, select: { user: { select: { email: true } } } },
        },
      },
    },
    orderBy: { trialEndsAt: "asc" },
    take,
  });
  let sent = 0;
  for (const trial of trials) {
    const left = daysLeft(trial.trialEndsAt, now);
    // One reminder per step: 3 days (more than 1 day left) and 1 day (1 day or less).
    const step = left <= 1 ? 1 : 3;
    if (step === 1 ? trial.trialReminder1At : trial.trialReminder3At) continue;
    const url = `${getEnv().APP_URL}/app/${trial.agency.slug}/billing`;
    for (const owner of trial.agency.members) {
      await sendBillingNoticeEmail(
        owner.user.email,
        step === 1
          ? `Your trial for ${trial.agency.name} ends tomorrow`
          : `Your trial for ${trial.agency.name} ends in ${left} days`,
        {
          preview: "Choose a plan to keep your account running",
          heading:
            step === 1 ? "Your free trial ends in 1 day" : `Your free trial ends in ${left} days`,
          paragraphs: [
            `Choose a plan for ${trial.agency.name} to keep tracking rankings and sending reports.`,
            "If you do nothing, your account becomes read-only. You will still see your data and nothing is deleted.",
          ],
          actionLabel: "Choose a plan",
          url,
        },
        `billing_trial${step}_${trial.agencyId}_${owner.user.email}`,
      );
    }
    await db.subscription.update({
      where: { id: trial.id },
      data:
        step === 1
          ? { trialReminder1At: now, trialReminder3At: trial.trialReminder3At ?? now }
          : { trialReminder3At: now },
    });
    sent++;
  }
  return sent;
}
