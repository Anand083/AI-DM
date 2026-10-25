"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { requestExportAction } from "@/app/app/[agencySlug]/settings/actions";
import { FormMessage } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ExportItem = {
  id: string;
  status: "QUEUED" | "READY" | "FAILED";
  size: string | null;
  created: string;
  expires: string;
};

export function DataExportPanel({
  agencySlug,
  items,
}: {
  agencySlug: string;
  items: ExportItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = items.some((i) => i.status === "QUEUED");

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  async function request() {
    setBusy(true);
    setError(null);
    const result = await requestExportAction(agencySlug);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <section aria-labelledby="export-h" className="space-y-3">
      <h2 id="export-h" className="text-lg font-semibold">
        Download your data
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Get a zip file with your clients, projects, rankings, audits, reports and activity. It does
        not include passwords or secret links. A download stays available for 7 days.
      </p>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Button type="button" variant="outline" onClick={request} disabled={busy || waiting}>
        {waiting ? "Preparing..." : "Prepare my data"}
      </Button>
      {items.length > 0 ? (
        <ul
          className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800"
          aria-label="Exports"
        >
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {i.created}
                {i.size ? ` (${i.size})` : ""}
              </span>
              {i.status === "READY" ? (
                <a
                  href={`/app/${agencySlug}/settings/export/${i.id}`}
                  className="underline underline-offset-4"
                >
                  Download zip
                  <span className="sr-only"> from {i.created}</span>
                </a>
              ) : i.status === "QUEUED" ? (
                <Badge tone="warning">Preparing</Badge>
              ) : (
                <Badge tone="danger">Failed</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
