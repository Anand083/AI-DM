"use server";

import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import { requestBacklinkCheck } from "@/server/services/backlinks";

const check = withTenantAction(
  { permission: "tools.run", schema: z.object({ projectId: z.string().min(1).max(100) }) },
  (ctx, input) => requestBacklinkCheck(ctx, input.projectId),
);

/** Asks the worker to check the backlinks now. The page refreshes itself when it is done. */
export async function checkBacklinksAction(slug: string, projectId: string) {
  return check(slug, { projectId });
}
