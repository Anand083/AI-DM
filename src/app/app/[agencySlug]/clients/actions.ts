"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { clientSchema } from "@/lib/schemas/client";
import { projectSchema } from "@/lib/schemas/project";
import { withTenantAction } from "@/server/auth/actions";
import {
  createClient,
  deleteClient,
  setClientArchived,
  updateClient,
} from "@/server/services/clients";
import { createProject, deleteProject, updateProject } from "@/server/services/projects";

const idSchema = z.string().min(1).max(100);

const create = withTenantAction(
  { permission: "content.edit", schema: clientSchema },
  (ctx, input) => createClient(ctx, input),
);
const update = withTenantAction(
  { permission: "content.edit", schema: z.object({ id: idSchema, values: clientSchema }) },
  (ctx, input) => updateClient(ctx, input.id, input.values),
);
const archive = withTenantAction(
  { permission: "content.edit", schema: z.object({ id: idSchema, archived: z.boolean() }) },
  (ctx, input) => setClientArchived(ctx, input.id, input.archived),
);
const remove = withTenantAction(
  { permission: "content.delete", schema: z.object({ id: idSchema }) },
  (ctx, input) => deleteClient(ctx, input.id),
);
const createProj = withTenantAction(
  { permission: "content.edit", schema: z.object({ clientId: idSchema, values: projectSchema }) },
  (ctx, input) => createProject(ctx, input.clientId, input.values),
);
const updateProj = withTenantAction(
  { permission: "content.edit", schema: z.object({ id: idSchema, values: projectSchema }) },
  (ctx, input) => updateProject(ctx, input.id, input.values),
);
const removeProj = withTenantAction(
  { permission: "content.delete", schema: z.object({ id: idSchema }) },
  (ctx, input) => deleteProject(ctx, input.id),
);

function refresh(slug: string) {
  revalidatePath(`/app/${slug}`, "layout");
}

export async function createClientAction(slug: string, values: unknown) {
  const result = await create(slug, values);
  if (result.ok) refresh(slug);
  return result;
}
export async function updateClientAction(slug: string, id: string, values: unknown) {
  const result = await update(slug, { id, values });
  if (result.ok) refresh(slug);
  return result;
}
export async function archiveClientAction(slug: string, id: string, archived: boolean) {
  const result = await archive(slug, { id, archived });
  if (result.ok) refresh(slug);
  return result;
}
export async function deleteClientAction(slug: string, id: string) {
  const result = await remove(slug, { id });
  if (result.ok) refresh(slug);
  return result;
}
export async function createProjectAction(slug: string, clientId: string, values: unknown) {
  const result = await createProj(slug, { clientId, values });
  if (result.ok) refresh(slug);
  return result;
}
export async function updateProjectAction(slug: string, id: string, values: unknown) {
  const result = await updateProj(slug, { id, values });
  if (result.ok) refresh(slug);
  return result;
}
export async function deleteProjectAction(slug: string, id: string) {
  const result = await removeProj(slug, { id });
  if (result.ok) refresh(slug);
  return result;
}
