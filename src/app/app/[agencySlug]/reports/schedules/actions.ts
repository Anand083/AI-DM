"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  reportScheduleSchema,
  scheduleIdSchema,
  scheduleToggleSchema,
} from "@/lib/schemas/report-schedule";
import { withTenantAction } from "@/server/auth/actions";
import {
  createSchedule,
  deleteSchedule,
  setScheduleEnabled,
  updateSchedule,
} from "@/server/services/report-schedules";

const create = withTenantAction(
  { permission: "reports.create", schema: reportScheduleSchema },
  async (ctx, input) => {
    const schedule = await createSchedule(ctx, input);
    return { scheduleId: schedule.id };
  },
);
const update = withTenantAction(
  {
    permission: "reports.create",
    schema: z.object({ scheduleId: z.string().min(1), values: reportScheduleSchema }),
  },
  (ctx, input) => updateSchedule(ctx, input.scheduleId, input.values),
);
const toggle = withTenantAction(
  { permission: "reports.create", schema: scheduleToggleSchema },
  (ctx, input) => setScheduleEnabled(ctx, input),
);
const remove = withTenantAction(
  { permission: "reports.create", schema: scheduleIdSchema },
  (ctx, input) => deleteSchedule(ctx, input),
);

const path = (slug: string) => `/app/${slug}/reports/schedules`;

export async function createScheduleAction(slug: string, values: unknown) {
  const result = await create(slug, values);
  if (result.ok) revalidatePath(path(slug));
  return result;
}

export async function toggleScheduleAction(slug: string, scheduleId: string, enabled: boolean) {
  const result = await toggle(slug, { scheduleId, enabled });
  if (result.ok) revalidatePath(path(slug));
  return result;
}

export async function deleteScheduleAction(slug: string, scheduleId: string) {
  const result = await remove(slug, { scheduleId });
  if (result.ok) revalidatePath(path(slug));
  return result;
}

export async function updateScheduleAction(slug: string, scheduleId: string, values: unknown) {
  const result = await update(slug, { scheduleId, values });
  if (result.ok) revalidatePath(path(slug));
  return result;
}
