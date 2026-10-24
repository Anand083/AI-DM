"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction, type ActionResult } from "@/server/auth/actions";
import {
  changeMemberRole,
  changeRoleSchema,
  inviteMember,
  inviteSchema,
  removeMember,
  resendInvitation,
  revokeInvitation,
} from "@/server/services/team";

const idSchema = z.object({ id: z.string().min(1).max(100) });

const invite = withTenantAction(
  { permission: "team.manage", schema: inviteSchema },
  async (ctx, input) => {
    await inviteMember(ctx, input);
  },
);
const resend = withTenantAction({ permission: "team.manage", schema: idSchema }, (ctx, input) =>
  resendInvitation(ctx, input.id),
);
const revoke = withTenantAction({ permission: "team.manage", schema: idSchema }, (ctx, input) =>
  revokeInvitation(ctx, input.id),
);
const changeRole = withTenantAction(
  { permission: "team.manage", schema: changeRoleSchema },
  (ctx, input) => changeMemberRole(ctx, input),
);
const remove = withTenantAction({ permission: "team.manage", schema: idSchema }, (ctx, input) =>
  removeMember(ctx, input.id),
);

async function refresh<T>(slug: string, result: ActionResult<T>): Promise<ActionResult<T>> {
  if (result.ok) revalidatePath(`/app/${slug}/team`);
  return result;
}

export async function inviteAction(slug: string, input: unknown) {
  return refresh(slug, await invite(slug, input));
}
export async function resendInvitationAction(slug: string, id: string) {
  return refresh(slug, await resend(slug, { id }));
}
export async function revokeInvitationAction(slug: string, id: string) {
  return refresh(slug, await revoke(slug, { id }));
}
export async function changeRoleAction(slug: string, memberId: string, role: string) {
  return refresh(slug, await changeRole(slug, { memberId, role }));
}
export async function removeMemberAction(slug: string, id: string) {
  return refresh(slug, await remove(slug, { id }));
}
