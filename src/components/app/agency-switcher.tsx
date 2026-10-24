"use client";

import { useRouter } from "next/navigation";
import type { UserAgency } from "@/server/auth/tenant-context";

export function AgencySwitcher({
  agencies,
  currentSlug,
}: {
  agencies: Pick<UserAgency, "id" | "name" | "slug">[];
  currentSlug: string;
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="agency-switcher" className="sr-only">
        Switch agency
      </label>
      <select
        id="agency-switcher"
        value={currentSlug}
        onChange={(e) => router.push(`/app/${e.target.value}`)}
        className="h-9 rounded-md border border-zinc-300 bg-transparent px-2 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-950"
      >
        {agencies.map((agency) => (
          <option key={agency.id} value={agency.slug}>
            {agency.name}
          </option>
        ))}
      </select>
    </div>
  );
}
