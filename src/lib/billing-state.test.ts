import { describe, expect, it } from "vitest";
import {
  daysLeft,
  GRACE_DAYS,
  isReadOnly,
  priceOf,
  transition,
  type BillingInput,
  type PlanPrice,
  type SubState,
} from "./billing-state";

const plans: PlanPrice[] = [
  { code: "STARTER", priceMonthlyCents: 4900, priceYearlyCents: 49000 },
  { code: "GROWTH", priceMonthlyCents: 14900, priceYearlyCents: 149000 },
  { code: "AGENCY", priceMonthlyCents: 39900, priceYearlyCents: 399000 },
];
const now = new Date("2026-03-10T12:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);

const base: SubState = {
  status: "ACTIVE",
  planCode: "GROWTH",
  interval: "MONTH",
  trialEndsAt: null,
  currentPeriodStart: new Date("2026-03-01T12:00:00Z"),
  currentPeriodEnd: new Date("2026-04-01T12:00:00Z"),
  cancelAtPeriodEnd: false,
  graceEndsAt: null,
  pendingPlanCode: null,
  pendingInterval: null,
};
const trial: SubState = {
  ...base,
  status: "TRIALING",
  planCode: "STARTER",
  trialEndsAt: day(5),
  currentPeriodStart: null,
  currentPeriodEnd: null,
};

function run(state: SubState, input: BillingInput, at = now) {
  const out = transition(state, input, at, plans);
  if (!out.ok) throw new Error(out.error);
  return out;
}
const error = (state: SubState, input: BillingInput) => {
  const out = transition(state, input, now, plans);
  if (out.ok) throw new Error("expected an error");
  return out.error;
};

describe("checkout.completed", () => {
  it("moves a trial to ACTIVE with a paid period and an invoice", () => {
    const out = run(trial, { type: "checkout.completed", planCode: "GROWTH", interval: "MONTH" });
    expect(out.state).toMatchObject({
      status: "ACTIVE",
      planCode: "GROWTH",
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
    });
    expect(out.state.currentPeriodStart).toEqual(now);
    expect(out.state.currentPeriodEnd?.toISOString()).toBe("2026-04-10T12:00:00.000Z");
    expect(out.effects).toEqual([
      expect.objectContaining({ type: "invoice", status: "PAID", amountCents: 14900 }),
    ]);
  });
  it("uses the yearly price and a year-long period", () => {
    const out = run(trial, { type: "checkout.completed", planCode: "AGENCY", interval: "YEAR" });
    expect(out.state.currentPeriodEnd?.toISOString()).toBe("2027-03-10T12:00:00.000Z");
    expect(out.effects[0]).toMatchObject({ amountCents: 399000 });
  });
  it.each(["EXPIRED", "CANCELED", "PAST_DUE"] as const)("brings %s back to ACTIVE", (status) => {
    const out = run(
      {
        ...base,
        status,
        graceEndsAt: day(2),
        cancelAtPeriodEnd: true,
        pendingPlanCode: "STARTER",
        pendingInterval: "MONTH",
      },
      { type: "checkout.completed", planCode: "STARTER", interval: "MONTH" },
    );
    expect(out.state).toMatchObject({
      status: "ACTIVE",
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      pendingPlanCode: null,
    });
  });
});

describe("payments", () => {
  it("a paid renewal starts the next period and applies a planned downgrade", () => {
    const due = {
      ...base,
      currentPeriodEnd: day(0),
      pendingPlanCode: "STARTER",
      pendingInterval: "MONTH" as const,
    };
    const out = run(due, { type: "payment.succeeded" });
    expect(out.state).toMatchObject({
      status: "ACTIVE",
      planCode: "STARTER",
      pendingPlanCode: null,
    });
    expect(out.state.currentPeriodStart).toEqual(now);
    expect(out.state.currentPeriodEnd?.toISOString()).toBe("2026-04-10T12:00:00.000Z");
    expect(out.effects[0]).toMatchObject({
      status: "PAID",
      amountCents: 4900,
      planCode: "STARTER",
    });
  });
  it("moves on until the period contains now after a long gap", () => {
    const old = {
      ...base,
      currentPeriodStart: new Date("2025-12-01T12:00:00Z"),
      currentPeriodEnd: new Date("2026-01-01T12:00:00Z"),
    };
    const out = run(old, { type: "payment.succeeded" });
    expect(out.state.currentPeriodEnd?.toISOString()).toBe("2026-04-01T12:00:00.000Z");
  });
  it("a late payment recovers PAST_DUE", () => {
    const out = run(
      { ...base, status: "PAST_DUE", graceEndsAt: day(3) },
      { type: "payment.succeeded" },
    );
    expect(out.state).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
  });
  it("a failed payment starts the 7 day grace period once", () => {
    const first = run(base, { type: "payment.failed" });
    expect(first.state.status).toBe("PAST_DUE");
    expect(first.state.graceEndsAt).toEqual(day(GRACE_DAYS));
    expect(first.effects.map((e) => e.type)).toEqual(["invoice", "payment_failed"]);
    expect(first.effects[0]).toMatchObject({ status: "FAILED" });
    // A second failure keeps the same deadline and does not warn again.
    const second = run(first.state, { type: "payment.failed" }, day(2));
    expect(second.state.graceEndsAt).toEqual(first.state.graceEndsAt);
    expect(second.effects.map((e) => e.type)).toEqual(["invoice"]);
  });
  it("ignores payments for ended or trial subscriptions", () => {
    for (const status of ["TRIALING", "EXPIRED", "CANCELED"] as const) {
      expect(run({ ...base, status }, { type: "payment.failed" })).toMatchObject({
        changed: false,
        effects: [],
      });
      expect(run({ ...base, status }, { type: "payment.succeeded" })).toMatchObject({
        changed: false,
        effects: [],
      });
    }
  });
});

describe("cancel and resume", () => {
  it("cancel at period end keeps ACTIVE until the period ends", () => {
    const out = run(base, { type: "cancel" });
    expect(out.state).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
    const ended = run(out.state, { type: "tick" }, new Date("2026-04-01T12:00:01Z"));
    expect(ended.state.status).toBe("CANCELED");
    expect(ended.effects).toEqual([{ type: "canceled" }]);
  });
  it("resume turns it back on", () => {
    const out = run({ ...base, cancelAtPeriodEnd: true }, { type: "resume" });
    expect(out.state.cancelAtPeriodEnd).toBe(false);
  });
  it("gives clear errors", () => {
    expect(error(trial, { type: "cancel" })).toMatch(/free trial/);
    expect(error({ ...base, status: "EXPIRED" }, { type: "cancel" })).toMatch(/already ended/);
    expect(error({ ...base, cancelAtPeriodEnd: true }, { type: "cancel" })).toMatch(
      /already set to end/,
    );
    expect(error(base, { type: "resume" })).toMatch(/not set to end/);
    expect(error({ ...base, status: "CANCELED" }, { type: "resume" })).toMatch(/Choose a plan/);
  });
  it("an immediate cancel from the provider ends it now", () => {
    const out = run(base, { type: "subscription.canceled" });
    expect(out.state.status).toBe("CANCELED");
    expect(run(out.state, { type: "subscription.canceled" }).changed).toBe(false);
  });
});

describe("change_plan", () => {
  it("an upgrade is immediate with a new period and an invoice", () => {
    const out = run(base, { type: "change_plan", planCode: "AGENCY", interval: "MONTH" });
    expect(out.state).toMatchObject({ planCode: "AGENCY", pendingPlanCode: null });
    expect(out.state.currentPeriodStart).toEqual(now);
    expect(out.effects[0]).toMatchObject({ status: "PAID", amountCents: 39900 });
  });
  it("a downgrade waits for the end of the period", () => {
    const out = run(base, { type: "change_plan", planCode: "STARTER", interval: "MONTH" });
    expect(out.state).toMatchObject({
      planCode: "GROWTH",
      pendingPlanCode: "STARTER",
      pendingInterval: "MONTH",
    });
    expect(out.effects).toEqual([]);
  });
  it("a billing interval change waits too, and choosing the current plan cancels a planned change", () => {
    const planned = run(base, { type: "change_plan", planCode: "GROWTH", interval: "YEAR" });
    expect(planned.state).toMatchObject({ pendingPlanCode: "GROWTH", pendingInterval: "YEAR" });
    const undone = run(planned.state, {
      type: "change_plan",
      planCode: "GROWTH",
      interval: "MONTH",
    });
    expect(undone.state).toMatchObject({ pendingPlanCode: null, pendingInterval: null });
  });
  it("is refused when it makes no sense", () => {
    expect(error(base, { type: "change_plan", planCode: "GROWTH", interval: "MONTH" })).toMatch(
      /already on this plan/,
    );
    expect(error(trial, { type: "change_plan", planCode: "GROWTH", interval: "MONTH" })).toMatch(
      /checkout/,
    );
    expect(
      error(
        { ...base, status: "PAST_DUE" },
        { type: "change_plan", planCode: "AGENCY", interval: "MONTH" },
      ),
    ).toMatch(/payment failed/);
    expect(
      error(
        { ...base, cancelAtPeriodEnd: true },
        { type: "change_plan", planCode: "AGENCY", interval: "MONTH" },
      ),
    ).toMatch(/set to end/);
  });
});

describe("tick", () => {
  it("expires a trial when it ends", () => {
    expect(run(trial, { type: "tick" }, day(4)).changed).toBe(false);
    const out = run(trial, { type: "tick" }, day(5));
    expect(out.state.status).toBe("EXPIRED");
    expect(out.effects).toEqual([{ type: "expired", reason: "trial" }]);
  });
  it("expires an unpaid subscription after the grace period", () => {
    const pastDue = { ...base, status: "PAST_DUE" as const, graceEndsAt: day(3) };
    expect(run(pastDue, { type: "tick" }, day(2)).changed).toBe(false);
    const out = run(pastDue, { type: "tick" }, day(3));
    expect(out.state.status).toBe("EXPIRED");
    expect(out.effects).toEqual([{ type: "expired", reason: "unpaid" }]);
  });
  it("asks for a renewal payment when the period is over", () => {
    expect(run(base, { type: "tick" }).effects).toEqual([]);
    const out = run(base, { type: "tick" }, new Date("2026-04-01T12:00:00Z"));
    expect(out.effects).toEqual([{ type: "renewal_due" }]);
    expect(out.changed).toBe(false);
  });
  it("does nothing for ended subscriptions", () => {
    for (const status of ["EXPIRED", "CANCELED"] as const) {
      expect(run({ ...base, status, currentPeriodEnd: day(-5) }, { type: "tick" }).effects).toEqual(
        [],
      );
    }
  });
});

describe("helpers", () => {
  it("priceOf, isReadOnly, daysLeft", () => {
    expect(priceOf(plans, "STARTER", "YEAR")).toBe(49000);
    expect(() => priceOf(plans, "NOPE", "MONTH")).toThrow();
    expect(isReadOnly("EXPIRED") && isReadOnly("CANCELED")).toBe(true);
    expect(isReadOnly("ACTIVE") || isReadOnly("PAST_DUE") || isReadOnly("TRIALING")).toBe(false);
    expect(daysLeft(day(3), now)).toBe(3);
    expect(daysLeft(new Date(now.getTime() + 3_600_000), now)).toBe(1);
    expect(daysLeft(day(-2), now)).toBe(0);
    expect(daysLeft(null, now)).toBe(0);
  });
});
