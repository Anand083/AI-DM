import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { SearchForm } from "@/components/ui/search-form";
import { listAgencies, type AgencyFilter } from "@/server/admin/agencies";
import { requireSuperAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Agencies" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const STATUSES = ["ACTIVE", "SUSPENDED"] as const;
const SUBSCRIPTIONS = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"] as const;
const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

export default async function AdminAgencies({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireSuperAdmin();
  const sp = await searchParams;
  const page = pageFromParams(sp.page);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const status = pick(sp.status, STATUSES);
  const subscription = pick(sp.subscription, SUBSCRIPTIONS);
  const filter: AgencyFilter = { q, status, subscription, page, pageSize: PAGE_SIZE };
  const { items, total } = await listAgencies(admin, filter);
  const link = (extra: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, subscription, ...extra }))
      if (v) query.set(k, v);
    const text = query.toString();
    return `/admin/agencies${text ? `?${text}` : ""}`;
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">Agencies</h1>
      <SearchForm label="Search agencies" placeholder="Search by name, address or email" q={q} />
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Filters" role="group">
        <span>
          Status:{" "}
          {[undefined, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={link({ status: s, page: undefined })}
              className={`mr-2 underline-offset-4 hover:underline ${s === status ? "font-semibold" : ""}`}
              aria-current={s === status ? "true" : undefined}
            >
              {s ? s.toLowerCase() : "all"}
            </Link>
          ))}
        </span>
        <span>
          Plan status:{" "}
          {[undefined, ...SUBSCRIPTIONS].map((s) => (
            <Link
              key={s ?? "all"}
              href={link({ subscription: s, page: undefined })}
              className={`mr-2 underline-offset-4 hover:underline ${s === subscription ? "font-semibold" : ""}`}
              aria-current={s === subscription ? "true" : undefined}
            >
              {s ? s.toLowerCase().replace("_", " ") : "all"}
            </Link>
          ))}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No agencies found" description="Try a different search or filter." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm" aria-label="Agencies">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  {["Agency", "Status", "Plan", "Members", "Clients", "Created"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/admin/agencies/${a.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {a.name}
                      </Link>
                      <span className="block text-xs font-normal text-zinc-600 dark:text-zinc-400">
                        {a.slug}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={a.status === "ACTIVE" ? "success" : "danger"}>
                        {a.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {a.subscription
                        ? `${a.subscription.plan.name} (${a.subscription.status.toLowerCase().replace("_", " ")})`
                        : "None"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{a._count.members}</td>
                    <td className="px-3 py-2 tabular-nums">{a._count.clients}</td>
                    <td className="px-3 py-2">{a.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            basePath="/admin/agencies"
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            params={{ q, status, subscription }}
          />
        </>
      )}
    </>
  );
}
