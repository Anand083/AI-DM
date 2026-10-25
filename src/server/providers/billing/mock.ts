import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { rawDb } from "@/server/db/client";
import {
  BillingSignatureError,
  type BillingProvider,
  type BillingWebhookEvent,
  type CheckoutInput,
} from "./types";

export const MOCK_SIGNATURE_HEADER = "x-mock-billing-signature";

const bodySchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum([
    "checkout.completed",
    "payment.succeeded",
    "payment.failed",
    "subscription.canceled",
  ]),
  agencyId: z.string().min(1),
  occurredAt: z.string(),
  planCode: z.string().optional(),
  interval: z.enum(["MONTH", "YEAR"]).optional(),
  checkoutId: z.string().optional(),
});

export function signMockBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Billing without a real payment company. The "checkout" is a page of our own with Pay and
 * Fail buttons. Those buttons send a signed webhook to our own endpoint, the same way a real
 * provider would, so the whole webhook path is exercised.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock" as const;

  constructor(private readonly options: { secret: string; appUrl: string }) {}

  async createCheckout(input: CheckoutInput) {
    const session = await rawDb.checkoutSession.create({
      data: { agencyId: input.agencyId, planCode: input.planCode, interval: input.interval },
      select: { id: true },
    });
    return {
      sessionId: session.id,
      url: `${this.options.appUrl}/app/${input.agencySlug}/billing/checkout/${session.id}`,
    };
  }

  async changePlan(): Promise<void> {}
  async cancel(): Promise<void> {}
  async resume(): Promise<void> {}

  async getPortalUrl(input: { agencySlug: string }) {
    return `${this.options.appUrl}/app/${input.agencySlug}/billing`;
  }

  /** The body and signature the mock checkout page sends. */
  signWebhook(event: Omit<BillingWebhookEvent, "occurredAt"> & { occurredAt: Date }) {
    const body = JSON.stringify({ ...event, occurredAt: event.occurredAt.toISOString() });
    return { body, signature: signMockBody(body, this.options.secret) };
  }

  verifyAndParseWebhook(rawBody: string, headers: Headers): BillingWebhookEvent {
    const given = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
    const expected = signMockBody(rawBody, this.options.secret);
    const a = Buffer.from(given, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BillingSignatureError();
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new BillingSignatureError("The webhook body is not valid JSON.");
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) throw new BillingSignatureError("The webhook body is not valid.");
    const occurredAt = new Date(parsed.data.occurredAt);
    if (Number.isNaN(occurredAt.getTime()))
      throw new BillingSignatureError("The webhook date is not valid.");
    return { ...parsed.data, occurredAt };
  }
}
