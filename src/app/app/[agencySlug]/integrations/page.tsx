import type { Metadata } from "next";
import { ApiKeysPanel, WebhooksPanel } from "@/components/app/integrations-panels";
import { getPageContext, requirePermission } from "@/server/auth/page-context";
import { getAgency } from "@/server/services/agency";
import { listApiKeys } from "@/server/services/api-keys";
import { listWebhooks } from "@/server/services/webhooks";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const ENDPOINTS = [
  ["GET /api/v1/clients", "Your clients"],
  ["GET /api/v1/projects", "Your projects (add ?client_id=...)"],
  ["GET /api/v1/projects/{projectId}/rankings", "Latest position of each keyword"],
  ["GET /api/v1/alerts", "Alerts (add ?unread=1)"],
];

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  requirePermission(ctx, "branding.edit");
  const [agency, keys, hooks] = await Promise.all([
    getAgency(ctx),
    listApiKeys(ctx),
    listWebhooks(ctx),
  ]);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: agency.timezone,
    }).format(d);

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Connect other tools with API keys and webhooks.
        </p>
      </div>

      <ApiKeysPanel
        agencySlug={agencySlug}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          lastUsed: k.lastUsedAt ? when(k.lastUsedAt) : null,
          created: when(k.createdAt),
          revoked: k.revokedAt !== null,
        }))}
      />

      <section aria-labelledby="api-docs-h" className="space-y-2">
        <h2 id="api-docs-h" className="text-lg font-semibold">
          What the API offers
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {ENDPOINTS.map(([path, text]) => (
            <li key={path}>
              <code>{path}</code>: {text}
            </li>
          ))}
        </ul>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Lists use <code>?page=1&amp;per_page=50</code> (up to 100) and return <code>data</code>,{" "}
          <code>page</code>, <code>perPage</code> and <code>total</code>. Each key may make 120
          requests a minute.
        </p>
      </section>

      <WebhooksPanel
        agencySlug={agencySlug}
        hooks={hooks.map((h) => ({
          id: h.id,
          url: h.url,
          format: h.format,
          secret: h.secret,
          enabled: h.enabled,
          lastError: h.lastError,
          recent: h.recent.map((d) => ({
            id: d.id,
            event: d.event,
            status: d.status,
            httpStatus: d.httpStatus,
            when: when(d.createdAt),
          })),
        }))}
      />
    </div>
  );
}
