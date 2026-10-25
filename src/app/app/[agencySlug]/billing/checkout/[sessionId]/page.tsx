import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MockCheckoutForm } from "@/components/app/mock-checkout-form";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { NotFoundError } from "@/server/services/errors";
import { getMockCheckout } from "@/server/services/billing";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function MockCheckoutPage({
  params,
}: {
  params: Promise<{ agencySlug: string; sessionId: string }>;
}) {
  const { agencySlug, sessionId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "billing.manage");
  const checkout = await getMockCheckout(ctx, sessionId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const price = (checkout.amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        This is a practice checkout. No real money is taken.
      </p>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt>Plan</dt>
          <dd className="font-medium">{checkout.planName}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Billed</dt>
          <dd className="font-medium">
            {checkout.interval === "YEAR" ? "Every year" : "Every month"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Total</dt>
          <dd className="font-medium">{price}</dd>
        </div>
      </dl>
      <MockCheckoutForm
        agencySlug={agencySlug}
        sessionId={checkout.id}
        open={checkout.status === "OPEN"}
      />
    </div>
  );
}
