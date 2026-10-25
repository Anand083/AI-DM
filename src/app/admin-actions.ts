"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEnv } from "@/env";
import { withAdminAction } from "@/server/admin/actions";
import {
  addBonusUsage,
  addOnSchema,
  bonusSchema,
  changeAgencyPlan,
  extendTrial,
  grantAddOn,
  removeAddOn,
  setAgencySuspended,
} from "@/server/admin/agencies";
import { requireSuperAdmin } from "@/server/admin/guard";
import { updatePlan } from "@/server/admin/plans";
import { testProviderConnection } from "@/server/admin/providers";
import { removeJob, retryJob, setQueuePaused } from "@/server/admin/queues";
import { setFeatureFlag, setMaintenanceMode, setProviderBudget } from "@/server/admin/settings";
import { endSupportSession, startSupportSession } from "@/server/admin/support-session";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_MINUTES,
  makeImpersonationToken,
} from "@/server/auth/impersonation-token";

const id = z.string().min(1).max(100);
const done = () => revalidatePath("/admin", "layout");

export const startSupportSessionAction = withAdminAction(
  z.object({ agencyId: id, userId: id.optional() }),
  async (admin, input) => {
    const session = await startSupportSession(admin, input.agencyId, input.userId);
    const env = getEnv();
    (await cookies()).set(
      IMPERSONATION_COOKIE,
      makeImpersonationToken(session.id, env.BETTER_AUTH_SECRET),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: env.COOKIE_SECURE,
        path: "/",
        maxAge: IMPERSONATION_MINUTES * 60,
      },
    );
    return { slug: session.slug };
  },
);

/** Used as a form action by the red banner. Works during a support session. */
export async function stopSupportSessionAction(): Promise<void> {
  const admin = await requireSuperAdmin();
  await endSupportSession(admin);
  (await cookies()).delete(IMPERSONATION_COOKIE);
  redirect("/admin");
}

export const setSuspendedAction = withAdminAction(
  z.object({ agencyId: id, suspended: z.boolean() }),
  async (admin, input) => {
    await setAgencySuspended(admin, input.agencyId, input.suspended);
    done();
  },
);
export const changeAgencyPlanAction = withAdminAction(
  z.object({ agencyId: id, planCode: z.string().min(1).max(50) }),
  async (admin, input) => {
    await changeAgencyPlan(admin, input.agencyId, input.planCode);
    done();
  },
);
export const extendTrialAction = withAdminAction(
  z.object({
    agencyId: id,
    days: z.number().int().min(1, "Enter at least 1 day.").max(365, "Up to 365 days."),
  }),
  async (admin, input) => {
    await extendTrial(admin, input.agencyId, input.days);
    done();
  },
);
export const addBonusAction = withAdminAction(
  z.object({ agencyId: id, bonus: bonusSchema }),
  async (admin, input) => {
    await addBonusUsage(admin, input.agencyId, input.bonus);
    done();
  },
);
export const grantAddOnAction = withAdminAction(
  z.object({ agencyId: id, addOn: addOnSchema }),
  async (admin, input) => {
    await grantAddOn(admin, input.agencyId, input.addOn);
    done();
  },
);
export const removeAddOnAction = withAdminAction(
  z.object({ agencyId: id, addOnId: id }),
  async (admin, input) => {
    await removeAddOn(admin, input.agencyId, input.addOnId);
    done();
  },
);

const queueJob = z.object({ queue: id, jobId: id });
export const retryJobAction = withAdminAction(queueJob, async (admin, input) => {
  await retryJob(admin, input.queue, input.jobId);
  done();
});
export const removeJobAction = withAdminAction(queueJob, async (admin, input) => {
  await removeJob(admin, input.queue, input.jobId);
  done();
});
export const pauseQueueAction = withAdminAction(
  z.object({ queue: id, paused: z.boolean() }),
  async (admin, input) => {
    await setQueuePaused(admin, input.queue, input.paused);
    done();
  },
);

export const testConnectionAction = withAdminAction(z.object({ provider: id }), (admin, input) =>
  testProviderConnection(admin, input.provider),
);

export const updatePlanAction = withAdminAction(
  z.object({ planId: id, values: z.unknown() }),
  async (admin, input) => {
    await updatePlan(admin, input.planId, input.values);
    done();
  },
);
export const setBudgetAction = withAdminAction(
  z.object({ usd: z.number() }),
  async (admin, input) => {
    await setProviderBudget(admin, input.usd);
    done();
  },
);
export const setMaintenanceAction = withAdminAction(
  z.object({ on: z.boolean() }),
  async (admin, input) => {
    await setMaintenanceMode(admin, input.on);
    done();
  },
);
export const setFlagAction = withAdminAction(
  z.object({ key: id, enabled: z.boolean() }),
  async (admin, input) => {
    await setFeatureFlag(admin, input.key, input.enabled);
    done();
  },
);
