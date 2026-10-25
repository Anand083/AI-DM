import { addMonthsUtc } from "./usage-period";

export type SubStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
export type Interval = "MONTH" | "YEAR";

export type SubState = {
  status: SubStatus;
  planCode: string;
  interval: Interval;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: Date | null;
  pendingPlanCode: string | null;
  pendingInterval: Interval | null;
};

export type PlanPrice = { code: string; priceMonthlyCents: number; priceYearlyCents: number };

/** Days a failed payment may stay unpaid before the account becomes read-only. */
export const GRACE_DAYS = 7;

export type BillingInput =
  | { type: "checkout.completed"; planCode: string; interval: Interval }
  | { type: "payment.succeeded" }
  | { type: "payment.failed" }
  | { type: "subscription.canceled" }
  | { type: "cancel" }
  | { type: "resume" }
  | { type: "change_plan"; planCode: string; interval: Interval }
  | { type: "tick" };

export type Effect =
  | {
      type: "invoice";
      status: "PAID" | "FAILED";
      planCode: string;
      interval: Interval;
      amountCents: number;
      periodStart: Date;
      periodEnd: Date;
    }
  /** The period ended and the customer should be charged for the next one. */
  | { type: "renewal_due" }
  | { type: "payment_failed"; graceEndsAt: Date }
  | { type: "expired"; reason: "trial" | "unpaid" }
  | { type: "canceled" };

export type Outcome =
  { ok: true; state: SubState; effects: Effect[]; changed: boolean } | { ok: false; error: string };

const DAY_MS = 86_400_000;

export function priceOf(plans: PlanPrice[], code: string, interval: Interval): number {
  const plan = plans.find((p) => p.code === code);
  if (!plan) throw new Error(`Unknown plan ${code}`);
  return interval === "YEAR" ? plan.priceYearlyCents : plan.priceMonthlyCents;
}

/** Higher means a bigger plan. Plans are compared by their monthly price. */
function rank(plans: PlanPrice[], code: string): number {
  return plans.find((p) => p.code === code)?.priceMonthlyCents ?? 0;
}

export const addInterval = (date: Date, interval: Interval): Date =>
  addMonthsUtc(date, interval === "YEAR" ? 12 : 1);

const fail = (error: string): Outcome => ({ ok: false, error });
const same = (state: SubState): Outcome => ({ ok: true, state, effects: [], changed: false });

function paidInvoice(
  plans: PlanPrice[],
  state: SubState,
  periodStart: Date,
  periodEnd: Date,
): Effect {
  return {
    type: "invoice",
    status: "PAID",
    planCode: state.planCode,
    interval: state.interval,
    amountCents: priceOf(plans, state.planCode, state.interval),
    periodStart,
    periodEnd,
  };
}

/**
 * The subscription rules in one place. A pure function: it takes the current state and one thing
 * that happened, and returns the new state plus what the caller should do about it (write an
 * invoice, send an email, charge the customer). Nothing here touches a database or a clock.
 */
export function transition(
  state: SubState,
  input: BillingInput,
  now: Date,
  plans: PlanPrice[],
): Outcome {
  switch (input.type) {
    case "checkout.completed": {
      // A completed checkout starts (or restarts) a paid plan from any state. This is also how
      // someone with an expired trial, a canceled plan or a failed payment comes back.
      const next: SubState = {
        ...state,
        status: "ACTIVE",
        planCode: input.planCode,
        interval: input.interval,
        trialEndsAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, input.interval),
        cancelAtPeriodEnd: false,
        graceEndsAt: null,
        pendingPlanCode: null,
        pendingInterval: null,
      };
      return {
        ok: true,
        state: next,
        effects: [paidInvoice(plans, next, now, next.currentPeriodEnd!)],
        changed: true,
      };
    }

    case "payment.succeeded": {
      // A renewal was paid, or a late payment came in during the grace period.
      if (state.status !== "ACTIVE" && state.status !== "PAST_DUE") return same(state);
      const plan = state.pendingPlanCode ?? state.planCode;
      const interval = state.pendingInterval ?? state.interval;
      let start = state.currentPeriodEnd ?? now;
      let end = addInterval(start, interval);
      // After a long gap, move on until the period contains now.
      while (end <= now) {
        start = end;
        end = addInterval(start, interval);
      }
      const next: SubState = {
        ...state,
        status: "ACTIVE",
        planCode: plan,
        interval,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        graceEndsAt: null,
        pendingPlanCode: null,
        pendingInterval: null,
      };
      return {
        ok: true,
        state: next,
        effects: [paidInvoice(plans, next, start, end)],
        changed: true,
      };
    }

    case "payment.failed": {
      if (state.status !== "ACTIVE" && state.status !== "PAST_DUE") return same(state);
      const graceEndsAt = state.graceEndsAt ?? new Date(now.getTime() + GRACE_DAYS * DAY_MS);
      const next: SubState = { ...state, status: "PAST_DUE", graceEndsAt };
      const start = state.currentPeriodEnd ?? now;
      const effects: Effect[] = [
        {
          type: "invoice",
          status: "FAILED",
          planCode: state.pendingPlanCode ?? state.planCode,
          interval: state.pendingInterval ?? state.interval,
          amountCents: priceOf(
            plans,
            state.pendingPlanCode ?? state.planCode,
            state.pendingInterval ?? state.interval,
          ),
          periodStart: start,
          periodEnd: addInterval(start, state.pendingInterval ?? state.interval),
        },
      ];
      // Only the first failure starts the clock and sends the warning.
      if (state.status === "ACTIVE") effects.push({ type: "payment_failed", graceEndsAt });
      return { ok: true, state: next, effects, changed: true };
    }

    case "subscription.canceled": {
      if (state.status === "CANCELED" || state.status === "EXPIRED") return same(state);
      return {
        ok: true,
        state: { ...state, status: "CANCELED", cancelAtPeriodEnd: false, graceEndsAt: null },
        effects: [{ type: "canceled" }],
        changed: true,
      };
    }

    case "cancel": {
      if (state.status === "TRIALING") {
        return fail("You are on a free trial. It ends by itself, so there is nothing to cancel.");
      }
      if (state.status !== "ACTIVE" && state.status !== "PAST_DUE") {
        return fail("Your subscription has already ended.");
      }
      if (state.cancelAtPeriodEnd) return fail("Your subscription is already set to end.");
      return { ok: true, state: { ...state, cancelAtPeriodEnd: true }, effects: [], changed: true };
    }

    case "resume": {
      if (state.status !== "ACTIVE" && state.status !== "PAST_DUE") {
        return fail("Your subscription has ended. Choose a plan to start again.");
      }
      if (!state.cancelAtPeriodEnd) return fail("Your subscription is not set to end.");
      return {
        ok: true,
        state: { ...state, cancelAtPeriodEnd: false },
        effects: [],
        changed: true,
      };
    }

    case "change_plan": {
      if (state.status === "PAST_DUE") {
        return fail("Your last payment failed. Update your payment first, then change your plan.");
      }
      if (state.status !== "ACTIVE") return fail("Choose a plan with checkout first.");
      if (state.cancelAtPeriodEnd)
        return fail("Your subscription is set to end. Turn it back on first.");
      if (input.planCode === state.planCode && input.interval === state.interval) {
        if (state.pendingPlanCode === null) return fail("You are already on this plan.");
        // Choosing the current plan again cancels a planned downgrade.
        return {
          ok: true,
          state: { ...state, pendingPlanCode: null, pendingInterval: null },
          effects: [],
          changed: true,
        };
      }
      if (rank(plans, input.planCode) > rank(plans, state.planCode)) {
        // Upgrade: starts now with a fresh period. (No part-month credit: a documented choice.)
        const next: SubState = {
          ...state,
          planCode: input.planCode,
          interval: input.interval,
          currentPeriodStart: now,
          currentPeriodEnd: addInterval(now, input.interval),
          pendingPlanCode: null,
          pendingInterval: null,
        };
        return {
          ok: true,
          state: next,
          effects: [paidInvoice(plans, next, now, next.currentPeriodEnd!)],
          changed: true,
        };
      }
      // Downgrade or billing interval change: keeps what was paid for until the period ends.
      return {
        ok: true,
        state: { ...state, pendingPlanCode: input.planCode, pendingInterval: input.interval },
        effects: [],
        changed: true,
      };
    }

    case "tick": {
      if (state.status === "TRIALING" && state.trialEndsAt && state.trialEndsAt <= now) {
        return {
          ok: true,
          state: { ...state, status: "EXPIRED" },
          effects: [{ type: "expired", reason: "trial" }],
          changed: true,
        };
      }
      if (state.status === "PAST_DUE" && state.graceEndsAt && state.graceEndsAt <= now) {
        return {
          ok: true,
          state: { ...state, status: "EXPIRED" },
          effects: [{ type: "expired", reason: "unpaid" }],
          changed: true,
        };
      }
      if (state.status === "ACTIVE" && state.currentPeriodEnd && state.currentPeriodEnd <= now) {
        if (state.cancelAtPeriodEnd) {
          return {
            ok: true,
            state: { ...state, status: "CANCELED", cancelAtPeriodEnd: false },
            effects: [{ type: "canceled" }],
            changed: true,
          };
        }
        return { ok: true, state, effects: [{ type: "renewal_due" }], changed: false };
      }
      return same(state);
    }
  }
}

/** True when the account may not start new work (data stays visible). */
export function isReadOnly(status: SubStatus): boolean {
  return status === "EXPIRED" || status === "CANCELED";
}

/** Whole days left until `end`, rounded up, never below 0. */
export function daysLeft(end: Date | null, now: Date): number {
  if (!end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}
