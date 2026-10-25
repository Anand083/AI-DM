import "server-only";
import { getEnv } from "@/env";
import { MockBillingProvider } from "./mock";
import type { BillingProvider } from "./types";

export type { BillingProvider, BillingWebhookEvent } from "./types";
export { BillingSignatureError } from "./types";

let provider: BillingProvider | undefined;

/** Picks the billing provider from `BILLING_PROVIDER`. Only the mock exists for now. */
export function getBillingProvider(): BillingProvider {
  if (provider) return provider;
  const env = getEnv();
  if (env.BILLING_PROVIDER !== "mock") {
    throw new Error(`BILLING_PROVIDER=${env.BILLING_PROVIDER} is not built yet. Use mock.`);
  }
  provider = new MockBillingProvider({
    secret: env.MOCK_BILLING_WEBHOOK_SECRET,
    appUrl: env.APP_URL,
  });
  return provider;
}

export function getMockBilling(): MockBillingProvider {
  const p = getBillingProvider();
  if (!(p instanceof MockBillingProvider))
    throw new Error("The mock billing provider is not active.");
  return p;
}
