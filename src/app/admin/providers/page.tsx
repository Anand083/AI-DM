import type { Metadata } from "next";
import { ProviderTest } from "@/components/admin/provider-test";
import { formatUsd } from "@/lib/admin-metrics";
import { requireSuperAdmin } from "@/server/admin/guard";
import { getProviderOverview } from "@/server/admin/providers";

export const metadata: Metadata = { title: "Data provider" };
export const dynamic = "force-dynamic";

export default async function AdminProviders() {
  const admin = await requireSuperAdmin();
  const o = await getProviderOverview(admin);
  return (
    <>
      <h1 className="text-2xl font-semibold">Data provider</h1>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-medium">Default provider</dt>
          <dd data-testid="default-provider">{o.defaultProvider}</dd>
        </div>
        <div>
          <dt className="font-medium">Environment</dt>
          <dd data-testid="provider-environment">{o.environment}</dd>
        </div>
        <div>
          <dt className="font-medium">Result delivery</dt>
          <dd>{o.callbackMode}</dd>
        </div>
      </dl>

      <section aria-labelledby="modules-h" className="space-y-2">
        <h2 id="modules-h" className="text-lg font-semibold">
          Provider for each part of the app
        </h2>
        <table className="w-full text-left text-sm" aria-label="Provider for each module">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th scope="col" className="py-1 pr-3 font-medium">
                Part
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Provider
              </th>
            </tr>
          </thead>
          <tbody>
            {o.modules.map((m) => (
              <tr key={m.module}>
                <td className="py-1 pr-3">{m.module}</td>
                <td className="py-1 pr-3">{m.provider}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="spend-h" className="space-y-2">
        <h2 id="spend-h" className="text-lg font-semibold">
          Spending
        </h2>
        <table className="w-full text-left text-sm" aria-label="Spending by provider">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              {["Provider", "Today", "This month"].map((h) => (
                <th key={h} scope="col" className="py-1 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.spend.map((s) => (
              <tr key={s.provider}>
                <td className="py-1 pr-3">{s.provider}</td>
                <td className="py-1 pr-3 tabular-nums">{formatUsd(s.todayCents)}</td>
                <td className="py-1 pr-3 tabular-nums">{formatUsd(s.monthCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="test-h" className="space-y-3">
        <h2 id="test-h" className="text-lg font-semibold">
          Test connection
        </h2>
        <div className="flex flex-wrap gap-4">
          <ProviderTest provider="mock" />
          <ProviderTest provider="dataforseo" />
        </div>
      </section>

      <section aria-labelledby="urls-h" className="space-y-2">
        <h2 id="urls-h" className="text-lg font-semibold">
          Callback addresses
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Give these to the provider so it can send results back. Add the callback secret as the
          provider asks.
        </p>
        <ul className="space-y-1 text-sm">
          {Object.entries(o.callbackUrls).map(([name, url]) => (
            <li key={name}>
              <span className="font-medium">{name}:</span>{" "}
              <input
                readOnly
                aria-label={`${name} address`}
                value={url}

                className="w-full max-w-xl rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-zinc-700"
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
