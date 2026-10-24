import type { Metadata } from "next";
import { TeamPanel } from "@/components/app/team-panel";
import { canManageMember, can } from "@/server/auth/permissions";
import { getPageContext } from "@/server/auth/page-context";
import { listMembers, listPendingInvitations } from "@/server/services/team";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const { user, ctx } = await getPageContext(agencySlug);

  const manage = can(ctx.role, "team.manage");
  const [members, invitations] = await Promise.all([
    listMembers(ctx, { pageSize: 100 }),
    manage
      ? listPendingInvitations(ctx, { pageSize: 100 })
      : Promise.resolve({ rows: [], total: 0 }),
  ]);

  return (
    <TeamPanel
      agencySlug={agencySlug}
      canManage={manage}
      members={members.rows.map((m) => ({
        id: m.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        isYou: m.user.id === user.id,
        editable: manage && m.user.id !== user.id && canManageMember(ctx.role, m.role),
      }))}
      invitations={invitations.rows.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
      }))}
    />
  );
}
