import { limitRequest } from "@/server/request-limit";
import { logger } from "@/server/logger";
import { BillingSignatureError } from "@/server/providers/billing";
import { handleBillingWebhook } from "@/server/services/billing";

/**
 * Billing webhooks. The signature is checked on the raw body before anything is read from it.
 * A repeated event answers 200 and changes nothing. A bad signature answers 400.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = await limitRequest(request, "billing-webhook", 600);
  if (limited) return limited;
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return new Response("Too large", { status: 413 });
  try {
    const result = await handleBillingWebhook(rawBody, request.headers);
    return Response.json(result);
  } catch (error) {
    if (error instanceof BillingSignatureError) {
      return new Response("Invalid signature", { status: 400 });
    }
    logger.error({ err: error }, "billing webhook failed");
    // 500 makes the provider send the event again.
    return new Response("Something went wrong", { status: 500 });
  }
}
