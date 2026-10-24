import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
  setClientArchived,
  updateClient,
} from "@/server/services/clients";
import { NotFoundError } from "@/server/services/errors";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/server/services/projects";
import { createAgencyWithMembers, seedPlans } from "../../factories";
import { createTestClient, resetDb } from "../../helpers/db";

const prisma = createTestClient();
const projectInput = {
  name: "Site",
  domain: "example.com",
  locationCode: 2840,
  languageCode: "en",
  device: "DESKTOP",
  rankCheckFrequency: "DAILY",
};

let a: Awaited<ReturnType<typeof createAgencyWithMembers>>;
let b: Awaited<ReturnType<typeof createAgencyWithMembers>>;
let clientB: { id: string };
let projectB: { id: string };

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
  a = await createAgencyWithMembers(prisma, ["OWNER"], "Agency A", "GROWTH");
  b = await createAgencyWithMembers(prisma, ["OWNER"], "Agency B", "GROWTH");
  clientB = await createClient(b.members[0]!.ctx, { name: "Client of B" });
  projectB = await createProject(b.members[0]!.ctx, clientB.id, projectInput);
  await createClient(a.members[0]!.ctx, { name: "Client of A" });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("tenant isolation: clients and projects", () => {
  const ctxA = () => a.members[0]!.ctx;

  it("lists only the own agency's rows", async () => {
    expect((await listClients(ctxA())).rows.map((c) => c.name)).toEqual(["Client of A"]);
    expect((await listProjects(ctxA())).total).toBe(0);
  });

  it("reading, updating, archiving and deleting another agency's client is not found", async () => {
    await expect(getClient(ctxA(), clientB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateClient(ctxA(), clientB.id, { name: "Hacked" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setClientArchived(ctxA(), clientB.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteClient(ctxA(), clientB.id)).rejects.toBeInstanceOf(NotFoundError);
    const row = await prisma.client.findUniqueOrThrow({ where: { id: clientB.id } });
    expect(row).toMatchObject({ name: "Client of B", status: "ACTIVE", deletedAt: null });
  });

  it("reading, updating and deleting another agency's project is not found", async () => {
    await expect(getProject(ctxA(), projectB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateProject(ctxA(), projectB.id, { ...projectInput, name: "Hacked" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteProject(ctxA(), projectB.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectB.id } })).deletedAt,
    ).toBeNull();
  });

  it("cannot add a project to another agency's client, or filter projects by its id", async () => {
    await expect(createProject(ctxA(), clientB.id, projectInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await listProjects(ctxA(), { clientId: clientB.id })).total).toBe(0);
  });
});
