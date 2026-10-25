"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  clientInviteSchema,
  inviteClientUser,
  removeClientUser,
  revokeClientInvitation,
} from "@/server/services/client-users";

const invite = withTenantAction(
  { permission: "clientUsers.invite", schema: clientInviteSchema },
  async (ctx, input) => {
    await inviteClientUser(ctx, input);
  },
);
const revoke = withTenantAction(
  { permission: "clientUsers.invite", schema: z.object({ id: z.string().min(1) }) },
  (ctx, input) => revokeClientInvitation(ctx, input.id),
);
const remove = withTenantAction(
  { permission: "clientUsers.invite", schema: z.object({ id: z.string().min(1) }) },
  (ctx, input) => removeClientUser(ctx, input.id),
);

const path = (slug: string, clientId: string) => `/app/${slug}/clients/${clientId}`;

export async function inviteClientUserAction(slug: string, clientId: string, email: string) {
  const result = await invite(slug, { clientId, email });
  if (result.ok) revalidatePath(path(slug, clientId));
  return result;
}
export async function revokeClientInviteAction(slug: string, clientId: string, id: string) {
  const result = await revoke(slug, { id });
  if (result.ok) revalidatePath(path(slug, clientId));
  return result;
}
export async function removeClientUserAction(slug: string, clientId: string, id: string) {
  const result = await remove(slug, { id });
  if (result.ok) revalidatePath(path(slug, clientId));
  return result;
}
