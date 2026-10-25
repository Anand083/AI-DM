import type { Interval } from "@/lib/billing-state";

/** What a billing provider tells us has happened, in our own words. */
export type BillingWebhookEvent = {
  /** Unique per event. The same id is only ever processed once. */
  id: string;
  type: "checkout.completed" | "payment.succeeded" | "payment.failed" | "subscription.canceled";
  agencyId: string;
  occurredAt: Date;
  planCode?: string;
  interval?: Interval;
  /** Mock checkout id, when the event comes from one. */
  checkoutId?: string;
};

export class BillingSignatureError extends Error {
  constructor(message = "Invalid webhook signature.") {
    super(message);
    this.name = "BillingSignatureError";
  }
}

export type CheckoutInput = {
  agencyId: string;
  agencySlug: string;
  planCode: string;
  interval: Interval;
};

export interface BillingProvider {
  readonly name: "mock" | "stripe" | "razorpay";
  /** Starts a checkout. The person is sent to `url` to pay. */
  createCheckout(input: CheckoutInput): Promise<{ url: string; sessionId: string }>;
  /** Tells the provider about a plan change we accepted (a real provider updates its subscription). */
  changePlan(input: { agencyId: string; planCode: string; interval: Interval }): Promise<void>;
  cancel(input: { agencyId: string }): Promise<void>;
  resume(input: { agencyId: string }): Promise<void>;
  /** A page where the customer manages their card and invoices at the provider. */
  getPortalUrl(input: { agencyId: string; agencySlug: string }): Promise<string>;
  /** Checks the signature on the raw request body and returns the event. Throws BillingSignatureError. */
  verifyAndParseWebhook(rawBody: string, headers: Headers): BillingWebhookEvent;
}
