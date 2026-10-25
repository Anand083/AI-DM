"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenantAction } from "@/server/auth/actions";
import {
  createLocation,
  deleteLocation,
  requestListingCheck,
  requestLocalRanks,
  updateLocation,
} from "@/server/services/locations";

const idSchema = z.string().min(1).max(100);
const withValues = z.object({ projectId: idSchema, values: z.unknown() });
const projectOnly = z.object({ projectId: idSchema });

const create = withTenantAction({ permission: "content.edit", schema: withValues }, (ctx, input) =>
  createLocation(ctx, input.projectId, input.values),
);
const update = withTenantAction(
  {
    permission: "content.edit",
    schema: z.object({ projectId: idSchema, locationId: idSchema, values: z.unknown() }),
  },
  (ctx, input) => updateLocation(ctx, input.projectId, input.locationId, input.values),
);
const remove = withTenantAction(
  { permission: "content.delete", schema: z.object({ projectId: idSchema, locationId: idSchema }) },
  (ctx, input) => deleteLocation(ctx, input.projectId, input.locationId),
);
const ranks = withTenantAction({ permission: "tools.run", schema: projectOnly }, (ctx, input) =>
  requestLocalRanks(ctx, input.projectId),
);
const listings = withTenantAction({ permission: "tools.run", schema: projectOnly }, (ctx, input) =>
  requestListingCheck(ctx, input.projectId),
);

const refresh = (slug: string, projectId: string) =>
  revalidatePath(`/app/${slug}/projects/${projectId}/locations`);

export async function createLocationAction(slug: string, projectId: string, values: unknown) {
  const result = await create(slug, { projectId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function updateLocationAction(
  slug: string,
  projectId: string,
  locationId: string,
  values: unknown,
) {
  const result = await update(slug, { projectId, locationId, values });
  if (result.ok) refresh(slug, projectId);
  return result;
}
export async function deleteLocationAction(slug: string, projectId: string, locationId: string) {
  const result = await remove(slug, { projectId, locationId });
  if (result.ok) refresh(slug, projectId);
  return result;
}
/** Asks the worker to check local positions. The page refreshes itself when it is done. */
export async function checkLocalRanksAction(slug: string, projectId: string) {
  return ranks(slug, { projectId });
}
/** Asks the worker to look up the directory listings. The page refreshes itself when it is done. */
export async function checkListingsAction(slug: string, projectId: string) {
  return listings(slug, { projectId });
}
