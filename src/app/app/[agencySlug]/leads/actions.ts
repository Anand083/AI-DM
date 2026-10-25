"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { deleteLead } from "@/server/services/leads";

const remove = withTenantAction(
  { permission: "content.delete", schema: z.object({ leadId: z.string().min(1).max(100) }) },
  (ctx, input) => deleteLead(ctx, input.leadId),
);

export async function deleteLeadAction(slug: string, leadId: string) {
  const result = await remove(slug, { leadId });
  if (result.ok) revalidatePath(`/app/${slug}/leads`);
  return result;
}
