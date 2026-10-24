import Link from "next/link";
import { languageName } from "@/data/languages";
import { locationName } from "@/data/locations";

type Row = {
  id: string;
  name: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  device: "DESKTOP" | "MOBILE";
  rankCheckFrequency: "DAILY" | "WEEKLY";
  client: { id: string; name: string };
};

/** Server-rendered table of projects. Pages around it handle search and paging. */
export function ProjectsTable({
  agencySlug,
  rows,
  showClient,
}: {
  agencySlug: string;
  rows: Row[];
  showClient: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm" aria-label="Projects">
        <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Project
            </th>
            {showClient ? (
              <th scope="col" className="px-4 py-2 font-medium">
                Client
              </th>
            ) : null}
            <th scope="col" className="px-4 py-2 font-medium">
              Domain
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Market
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Checks
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-2 font-medium">
                <Link
                  href={`/app/${agencySlug}/projects/${p.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {p.name}
                </Link>
              </td>
              {showClient ? (
                <td className="px-4 py-2">
                  <Link
                    href={`/app/${agencySlug}/clients/${p.client.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {p.client.name}
                  </Link>
                </td>
              ) : null}
              <td className="px-4 py-2">{p.domain}</td>
              <td className="px-4 py-2">
                {locationName(p.locationCode)}, {languageName(p.languageCode)},{" "}
                {p.device === "MOBILE" ? "mobile" : "desktop"}
              </td>
              <td className="px-4 py-2">
                {p.rankCheckFrequency === "DAILY" ? "Every day" : "Every week"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
