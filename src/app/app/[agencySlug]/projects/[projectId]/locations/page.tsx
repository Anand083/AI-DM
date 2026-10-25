import type { Metadata } from "next";
import { LocationForm } from "@/components/app/location-form";
import { CheckListingsButton, CheckLocalRanksButton } from "@/components/app/location-job-buttons";
import { Badge } from "@/components/ui/badge";
import { MAX_LOCATIONS } from "@/lib/local";
import { FeatureNotice } from "@/components/app/feature-notice";
import { featureUnavailable } from "@/server/services/feature-status";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getLocalOverview } from "@/server/services/locations";

export const metadata: Metadata = { title: "Locations" };
export const dynamic = "force-dynamic";

const head = "border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";
const rowCls = "border-b border-zinc-100 last:border-0 dark:border-zinc-900";
const FIELD_LABEL = { name: "name", address: "address", phone: "phone number" } as const;

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const overview = await getLocalOverview(ctx, projectId);
  const canEdit = can(ctx.role, "content.edit");
  const canRun = can(ctx.role, "tools.run");
  const today = new Date().toISOString().slice(0, 10);
  const { locations, ranks } = overview;
  const listingsOn =
    locations
      .map((l) => l.listingsCheckedOn)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;

  const unavailable = featureUnavailable("listings");
  return (
    <div className="space-y-8">
      {unavailable ? <FeatureNotice message={unavailable} /> : null}
      <div>
        <h2 className="text-lg font-semibold">Locations</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The places this business works from (up to {MAX_LOCATIONS}). Check where the keywords rank
          from each place, and whether the business details are the same in every directory.
        </p>
      </div>

      {locations.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No locations yet. Add the first one below.
        </p>
      ) : (
        <ul aria-label="Locations" className="space-y-3">
          {locations.map((l) => (
            <li key={l.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{l.name}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{l.city}</span>
                {l.score !== null ? (
                  <Badge tone={l.score >= 80 ? "success" : "neutral"}>
                    Details match: {l.score}%
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {l.address} · {l.phone}
              </p>
              {canEdit ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium">Change details</summary>
                  <div className="mt-3">
                    <LocationForm
                      agencySlug={agencySlug}
                      projectId={projectId}
                      location={l}
                      canDelete={can(ctx.role, "content.delete")}
                    />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && locations.length < MAX_LOCATIONS ? (
        <section aria-labelledby="add-location-heading" className="space-y-3">
          <h3 id="add-location-heading" className="text-base font-semibold">
            Add a location
          </h3>
          <LocationForm agencySlug={agencySlug} projectId={projectId} />
        </section>
      ) : null}

      {locations.length > 0 ? (
        <section aria-labelledby="local-ranks-heading" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="local-ranks-heading" className="text-base font-semibold">
                Local positions
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Where the keywords rank as seen from each place. Keywords tagged &quot;local&quot;
                are used, or the first 25.
                {ranks.on ? ` Checked ${ranks.on}.` : ""}
                {ranks.sample ? " This is sample data, not real Google results." : ""}
              </p>
            </div>
            {canRun ? (
              <CheckLocalRanksButton
                agencySlug={agencySlug}
                projectId={projectId}
                label={ranks.on ? "Check again" : "Check local positions"}
                doneToday={ranks.on === today}
              />
            ) : null}
          </div>
          {ranks.rows.length > 0 ? (
            <div
              role="region"
              aria-label="Local positions table"
              tabIndex={0}
              className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <table className="w-full text-left text-sm" aria-label="Local positions">
                <thead className={head}>
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Keyword
                    </th>
                    {locations.map((l) => (
                      <th key={l.id} scope="col" className="px-4 py-2 font-medium">
                        {l.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ranks.rows.map((r) => (
                    <tr key={r.phrase} className={rowCls}>
                      <td className="px-4 py-2 font-medium">{r.phrase}</td>
                      {locations.map((l) => {
                        const cell = r.byLocation[l.id];
                        return (
                          <td key={l.id} className="px-4 py-2 tabular-nums">
                            {!cell
                              ? "-"
                              : cell.position === null
                                ? "Not in top 100"
                                : cell.position}
                            {cell && cell.change !== null && cell.change !== 0
                              ? ` (${cell.change > 0 ? "up" : "down"} ${Math.abs(cell.change)})`
                              : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {locations.length > 0 ? (
        <section aria-labelledby="listings-heading" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="listings-heading" className="text-base font-semibold">
                Listings in directories
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Does each directory show the same name, address and phone number as above? Mixed
                details confuse Google and customers.
                {listingsOn ? ` Checked ${listingsOn}.` : ""}
                {overview.listingsSample ? " This is sample data, not real directory results." : ""}
              </p>
            </div>
            {canRun ? (
              <CheckListingsButton
                agencySlug={agencySlug}
                projectId={projectId}
                label={listingsOn ? "Check again" : "Check listings"}
                doneToday={listingsOn === today}
              />
            ) : null}
          </div>
          {locations.map((l) =>
            l.listings.length === 0 ? null : (
              <div key={l.id} className="space-y-1">
                <h4 className="text-sm font-semibold">{l.name}</h4>
                <div
                  role="region"
                  aria-label={`${l.name} listings table`}
                  tabIndex={0}
                  className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <table className="w-full text-left text-sm" aria-label={`Listings for ${l.name}`}>
                    <thead className={head}>
                      <tr>
                        {["Directory", "Result", "What to fix"].map((h) => (
                          <th key={h} scope="col" className="px-4 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {l.listings.map((x) => (
                        <tr key={x.source} className={rowCls}>
                          <td className="px-4 py-2 font-medium">{x.source}</td>
                          <td className="px-4 py-2">
                            {x.comparison.status === "match"
                              ? "Matches"
                              : x.comparison.status === "missing"
                                ? "No listing found"
                                : "Different"}
                          </td>
                          <td className="px-4 py-2">
                            {x.comparison.wrong
                              .map((w) => `${FIELD_LABEL[w]} shows "${x.shown[w] ?? "nothing"}"`)
                              .join("; ") || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          )}
        </section>
      ) : null}
    </div>
  );
}
