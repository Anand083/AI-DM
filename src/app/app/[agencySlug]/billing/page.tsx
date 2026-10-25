import type { Metadata } from "next";
import Link from "next/link";
import { BillingPlans } from "@/components/app/billing-plans";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";
import { getBillingSummary, listInvoices } from "@/server/services/billing";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

const STATUS = {
  TRIALING: { label: "Free trial", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  PAST_DUE: { label: "Payment failed", tone: "danger" },
  CANCELED: { label: "Canceled", tone: "neutral" },
  EXPIRED: { label: "Read-only", tone: "danger" },
} as const;

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "billing.manage");
  const page = pageFromParams(sp.page);
  const [summary, invoices, agency] = await Promise.all([
    getBillingSummary(ctx),
    listInvoices(ctx, { page, pageSize: PAGE_SIZE }),
    getAgency(ctx),
  ]);
  const { state } = summary;
  const date = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: agency.timezone }).format(d)
      : "-";
  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const checkout = typeof sp.checkout === "string" ? sp.checkout : null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Billing</h1>

      {checkout === "paid" ? (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-300"
        >
          Thank you. Your payment worked and your plan is active.
        </p>
      ) : null}
      {checkout === "failed" ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          The payment failed. Nothing was charged. You can try again below.
        </p>
      ) : null}

      <section
        aria-labelledby="current-heading"
        className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="current-heading" className="text-lg font-semibold">
            {summary.planName} plan
          </h2>
          <Badge tone={STATUS[state.status].tone}>{STATUS[state.status].label}</Badge>
        </div>
        {state.status === "TRIALING" ? (
          <p className="text-sm">
            Your free trial ends on {date(state.trialEndsAt)} ({summary.trialDaysLeft}{" "}
            {summary.trialDaysLeft === 1 ? "day" : "days"} left). Choose a plan below to keep going.
          </p>
        ) : null}
        {state.status === "ACTIVE" ? (
          <p className="text-sm">
            {money(summary.price)} {state.interval === "YEAR" ? "per year" : "per month"}.{" "}
            {state.cancelAtPeriodEnd
              ? `Your subscription ends on ${date(state.currentPeriodEnd)}.`
              : `Next payment on ${date(state.currentPeriodEnd)}.`}
          </p>
        ) : null}
        {summary.pendingPlanName ? (
          <p className="text-sm">
            On {date(state.currentPeriodEnd)} your plan changes to {summary.pendingPlanName}.
          </p>
        ) : null}
        {state.status === "PAST_DUE" ? (
          <p className="text-sm">
            Your last payment failed. Pay again by {date(state.graceEndsAt)} to keep your account
            running. After that it becomes read-only.
          </p>
        ) : null}
        {state.status === "EXPIRED" || state.status === "CANCELED" ? (
          <p className="text-sm">
            Your account is read-only: you can see your data, but new checks, audits and reports are
            paused. Choose a plan to start again.
          </p>
        ) : null}
        <p className="text-sm">
          <Link href={`/app/${agencySlug}/usage`} className="underline underline-offset-4">
            See your usage
          </Link>
        </p>
      </section>

      <BillingPlans
        agencySlug={agencySlug}
        plans={summary.plans}
        status={state.status}
        currentCode={state.planCode}
        currentInterval={state.interval}
        pendingCode={state.pendingPlanCode}
        cancelAtPeriodEnd={state.cancelAtPeriodEnd}
      />

      <section aria-labelledby="invoices-heading" className="space-y-3">
        <h2 id="invoices-heading" className="text-lg font-semibold">
          Invoices
        </h2>
        {invoices.items.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Your invoices will show here after your first payment."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm" aria-label="Invoices">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    {["Invoice", "Description", "Date", "Amount", "Status"].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {invoices.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2 font-mono text-xs">{i.number}</td>
                      <td className="px-3 py-2">{i.description}</td>
                      <td className="px-3 py-2">{date(i.createdAt)}</td>
                      <td className="px-3 py-2 tabular-nums">{money(i.amountCents)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={i.status === "PAID" ? "success" : "danger"}>
                          {i.status === "PAID" ? "Paid" : "Failed"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath={`/app/${agencySlug}/billing`}
              page={page}
              pageSize={PAGE_SIZE}
              total={invoices.total}
            />
          </>
        )}
      </section>
    </div>
  );
}
