import type { Metadata } from "next";
import { FinanceSettingsForm, RetainerForm } from "@/components/app/finance-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/money";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getFinanceSettings, getProfitReport } from "@/server/services/finance";

export const metadata: Metadata = { title: "Profitability" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ProfitabilityPage({
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
  const [settings, report] = await Promise.all([
    getFinanceSettings(ctx),
    getProfitReport(ctx, { page, pageSize: PAGE_SIZE }),
  ]);
  const money = (cents: number | null) =>
    cents === null ? "Not known" : formatMoney(cents, report.baseCurrency);
  const hourly = settings.hourlyCostCents
    ? (settings.hourlyCostCents / 100).toFixed(2).replace(/\.00$/, "")
    : "";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Profitability</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          A simple estimate for {report.month} (day {report.day} of {report.daysInMonth}). Income is
          the monthly retainer. Costs are what data providers charged for the client&apos;s projects
          plus the time on finished tasks. This is a guide, not accounting.
        </p>
      </div>

      <section aria-labelledby="totals-heading" className="space-y-3">
        <h2 id="totals-heading" className="text-lg font-semibold">
          This month in total
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["Retainers", money(report.totals.revenueCents)],
            ["Provider costs", money(report.totals.providerCents)],
            ["Time cost", money(report.totals.timeCents)],
            ["Estimated margin", money(report.totals.marginCents)],
            ["Provider cost by month end", money(report.totals.forecastProviderCents)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt>
              <dd className="mt-1 text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {report.totals.skipped > 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {report.totals.skipped} clients are left out of the totals because a retainer or an
            exchange rate is missing.
          </p>
        ) : null}
        {report.missingRates.length > 0 ? (
          <p role="status" className="text-sm text-amber-800 dark:text-amber-300">
            Add an exchange rate for {report.missingRates.join(", ")} below to include those
            amounts.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="clients-heading" className="space-y-3">
        <h2 id="clients-heading" className="text-lg font-semibold">
          Clients
        </h2>
        {report.rows.length === 0 ? (
          <EmptyState title="No clients yet" description="Add a client to see its profit here." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Estimated profit per client</caption>
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th scope="col" className="py-2 pr-3">
                      Client
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Monthly retainer
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Provider cost
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Time cost
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Margin
                    </th>
                    <th scope="col" className="py-2">
                      By month end
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr
                      key={r.clientId}
                      className="border-b border-zinc-100 align-top dark:border-zinc-900"
                    >
                      <th scope="row" className="py-2 pr-3 font-medium">
                        {r.name}
                      </th>
                      <td className="py-2 pr-3">
                        <RetainerForm
                          agencySlug={agencySlug}
                          clientId={r.clientId}
                          clientName={r.name}
                          initialAmount={
                            r.retainerCents === null
                              ? ""
                              : (r.retainerCents / 100).toFixed(2).replace(/\.00$/, "")
                          }
                          initialCurrency={r.retainerCurrency}
                        />
                      </td>
                      <td className="py-2 pr-3">{money(r.providerCents)}</td>
                      <td className="py-2 pr-3">{money(r.timeCents)}</td>
                      <td className="py-2 pr-3">
                        {money(r.marginCents)}
                        {r.marginPercent !== null ? ` (${r.marginPercent}%)` : ""}
                      </td>
                      <td className="py-2">{money(r.forecastProviderCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath={`/app/${agencySlug}/profitability`}
              page={page}
              pageSize={PAGE_SIZE}
              total={report.total}
            />
          </>
        )}
      </section>

      <section aria-labelledby="money-heading" className="max-w-2xl space-y-3">
        <h2 id="money-heading" className="text-lg font-semibold">
          Money settings
        </h2>
        <FinanceSettingsForm
          agencySlug={agencySlug}
          initial={{
            baseCurrency: settings.baseCurrency,
            hourlyCost: hourly,
            rates: settings.rates,
          }}
        />
      </section>
    </div>
  );
}
