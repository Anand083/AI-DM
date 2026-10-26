import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientActions } from "@/components/app/client-actions";
import { ClientUsersPanel } from "@/components/app/client-users-panel";
import { ProjectsTable } from "@/components/app/projects-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getEnv } from "@/env";
import { ProgressCard } from "@/components/app/progress-card";
import { getClientProgress } from "@/server/services/progress";
import { getClient } from "@/server/services/clients";
import { listClientUsers } from "@/server/services/client-users";
import { NotFoundError } from "@/server/services/errors";
import { listProjects } from "@/server/services/projects";

export const metadata: Metadata = { title: "Client" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const buttonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, clientId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const client = await getClient(ctx, clientId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const page = pageFromParams(sp.page);
  const [{ rows, total }, progress] = await Promise.all([
    listProjects(ctx, { clientId, page, pageSize: PAGE_SIZE }),
    getClientProgress(ctx, clientId),
  ]);
  const base = `/app/${agencySlug}/clients/${client.id}`;
  const canEdit = can(ctx.role, "content.edit");
  const canInvite = can(ctx.role, "clientUsers.invite");
  const access = canInvite ? await listClientUsers(ctx, clientId) : { users: [], pending: [] };
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(d);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link
              href={`/app/${agencySlug}/clients`}
              className="underline-offset-4 hover:underline"
            >
              Clients
            </Link>
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold">
            {client.name}
            {client.status === "ARCHIVED" ? <Badge>Archived</Badge> : null}
          </h1>
        </div>
        {canEdit ? (
          <Link href={`${base}/edit`} className={buttonClass}>
            Edit client
          </Link>
        ) : null}
      </div>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Website</dt>
          <dd className="text-zinc-600 dark:text-zinc-400">{client.website ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="font-medium">Contact</dt>
          <dd className="text-zinc-600 dark:text-zinc-400">
            {[client.contactName, client.contactEmail].filter(Boolean).join(" · ") || "Not set"}
          </dd>
        </div>
        {client.notes ? (
          <div className="sm:col-span-2">
            <dt className="font-medium">Notes</dt>
            <dd className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{client.notes}</dd>
          </div>
        ) : null}
      </dl>

      <ProgressCard progress={progress} />

      <section aria-labelledby="projects-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="projects-heading" className="text-lg font-semibold">
            Projects
          </h2>
          {canEdit && client.status === "ACTIVE" ? (
            <Link href={`${base}/projects/new`} className={buttonClass}>
              Add project
            </Link>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="A project is one website you track for this client."
          />
        ) : (
          <>
            <ProjectsTable agencySlug={agencySlug} rows={rows} showClient={false} />
            <Pagination basePath={base} page={page} pageSize={PAGE_SIZE} total={total} />
          </>
        )}
      </section>

      {canInvite ? (
        <ClientUsersPanel
          agencySlug={agencySlug}
          clientId={client.id}
          portalUrl={`${getEnv().APP_URL}/portal/${agencySlug}`}
          users={access.users.map((u) => ({ id: u.id, name: u.user.name, email: u.user.email }))}
          pending={access.pending.map((p) => ({
            id: p.id,
            email: p.email,
            expires: when(p.expiresAt),
          }))}
          canInvite={canInvite}
        />
      ) : null}

      <ClientActions
        agencySlug={agencySlug}
        clientId={client.id}
        clientName={client.name}
        archived={client.status === "ARCHIVED"}
        canEdit={canEdit}
        canDelete={can(ctx.role, "content.delete")}
      />
    </div>
  );
}
