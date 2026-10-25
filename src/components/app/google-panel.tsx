"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  chooseSourcesAction,
  disconnectGoogleAction,
  syncGoogleAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/analytics/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { JobButton } from "./job-button";

type Connection = {
  accountEmail: string | null;
  status: string;
  lastError: string | null;
  lastSyncedOn: string | null;
  gscSite: string | null;
  ga4PropertyId: string | null;
  sites: { siteUrl: string; permissionLevel: string }[];
  properties: { propertyId: string; displayName: string }[];
};

const linkClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

/** Connect Google, choose the site and property to read, update the numbers, or disconnect. */
export function GooglePanel({
  agencySlug,
  projectId,
  connection,
  canEdit,
  canRun,
  syncedToday,
}: {
  agencySlug: string;
  projectId: string;
  connection: Connection | null;
  canEdit: boolean;
  canRun: boolean;
  syncedToday: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [site, setSite] = useState(connection?.gscSite ?? "");
  const [property, setProperty] = useState(connection?.ga4PropertyId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startUrl = `/api/google/start?agency=${encodeURIComponent(agencySlug)}&project=${encodeURIComponent(projectId)}`;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await chooseSourcesAction(agencySlug, projectId, {
      gscSite: site || null,
      ga4PropertyId: property || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("success", "Saved. We are reading the numbers now.");
    router.refresh();
  }

  if (!connection) {
    return canEdit ? (
      <div className="space-y-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Connect the Google account that can see this website in Search Console and Google
          Analytics. We only ask to read the numbers.
        </p>
        <a href={startUrl} className={linkClass}>
          Connect Google
        </a>
      </div>
    ) : (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Google is not connected yet.</p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Connected{connection.accountEmail ? ` as ${connection.accountEmail}` : ""}.
        {connection.lastSyncedOn ? ` Numbers updated on ${connection.lastSyncedOn}.` : ""}
      </p>
      {connection.status !== "ACTIVE" ? (
        <FormMessage kind="error">
          {connection.lastError ?? "Google no longer accepts this connection."} Connect again to
          keep the numbers coming.
        </FormMessage>
      ) : null}

      {canEdit ? (
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="gsc-site">Search Console site</Label>
            <Select id="gsc-site" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">Do not read Search Console</option>
              {connection.sites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ga4-property">Google Analytics 4 property</Label>
            <Select
              id="ga4-property"
              value={property}
              onChange={(e) => setProperty(e.target.value)}
            >
              <option value="">Do not read Google Analytics</option>
              {connection.properties.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || (!site && !property)}>
              Save choice
            </Button>
          </div>
        </form>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <div className="flex flex-wrap items-start gap-3">
        {canRun &&
        connection.status === "ACTIVE" &&
        (connection.gscSite || connection.ga4PropertyId) ? (
          <JobButton
            run={() => syncGoogleAction(agencySlug, projectId)}
            label="Update numbers"
            busyText="Reading the numbers from Google. This page updates by itself."
            doneToday={syncedToday}
            doneText="Already updated today."
          />
        ) : null}
        {canEdit && connection.status !== "ACTIVE" ? (
          <a href={startUrl} className={linkClass}>
            Connect again
          </a>
        ) : null}
        {canEdit ? (
          <ConfirmDialog
            trigger="Disconnect Google"
            title="Disconnect Google?"
            description="The connection and the numbers saved from Google for this project will be deleted."
            confirmLabel="Disconnect"
            onConfirm={async () => {
              const result = await disconnectGoogleAction(agencySlug, projectId);
              if (!result.ok) return result.error;
              setSite("");
              setProperty("");
              router.refresh();
              return null;
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
