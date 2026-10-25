import {
  advanceBillingClock,
  advanceSchema,
  devBillingAllowed,
} from "@/server/services/billing-dev";
import { AppError } from "@/server/services/errors";

/** Development and tests only: move a subscription's clock forward. Not found in production. */
export async function POST(request: Request): Promise<Response> {
  if (!devBillingAllowed()) return new Response("Not found", { status: 404 });
  const parsed = advanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid input." }, { status: 400 });
  try {
    return Response.json(await advanceBillingClock(parsed.data));
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
