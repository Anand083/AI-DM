import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
  setClientArchived,
  updateClient,
} from "@/server/services/clients";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/server/services/projects";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();

const projectInput = {
  name: "Main site",
  domain: "https://www.Example.com/",
  locationCode: 2840,
  languageCode: "en",
  device: "DESKTOP",
  rankCheckFrequency: "DAILY",
};

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function setup(plan = "GROWTH") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
    plan,
  );
  return { agency, owner: members[0]!.ctx, admin: members[1]!.ctx, member: members[2]!.ctx };
}

describe("clients", () => {
  it("creates, reads, updates and lists a client", async () => {
    const { owner, agency } = await setup();
    const created = await createClient(owner, {
      name: "  Bright Dental ",
      website: "www.brightdental.com/about",
      contactEmail: "Hello@BrightDental.com",
    });
    const client = await getClient(owner, created.id);
    expect(client).toMatchObject({
      name: "Bright Dental",
      website: "https://brightdental.com",
      contactEmail: "hello@brightdental.com",
      status: "ACTIVE",
    });
    await updateClient(owner, created.id, {
      name: "Bright Dental Care",
      website: "",
      notes: "VIP",
    });
    const updated = await getClient(owner, created.id);
    expect(updated).toMatchObject({ name: "Bright Dental Care", website: null, notes: "VIP" });
    const list = await listClients(owner);
    expect(list.total).toBe(1);
    const log = await prisma.activityLog.findMany({
      where: { agencyId: agency.id },
      select: { action: true },
    });
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining(["client.created", "client.updated"]),
    );
  });

  it("validates input with field errors", async () => {
    const { owner } = await setup();
    await expect(createClient(owner, { name: "x" })).rejects.toMatchObject({
      fieldErrors: { name: expect.any(String) },
    });
    await expect(
      createClient(owner, { name: "Fine Name", website: "not a site" }),
    ).rejects.toMatchObject({
      fieldErrors: { website: expect.any(String) },
    });
    await expect(
      createClient(owner, { name: "Fine Name", contactEmail: "nope" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("filters by search and status, and pages", async () => {
    const { owner } = await setup();
    for (const name of ["Alpha Co", "Beta Co", "Gamma Co"]) await createClient(owner, { name });
    const beta = (await listClients(owner, { q: "beta" })).rows;
    expect(beta.map((c) => c.name)).toEqual(["Beta Co"]);
    const page2 = await listClients(owner, { page: 2, pageSize: 2 });
    expect(page2.rows.map((c) => c.name)).toEqual(["Gamma Co"]);
    expect(page2.total).toBe(3);
    const first = (await listClients(owner)).rows[0]!;
    await setClientArchived(owner, first.id, true);
    expect((await listClients(owner, { status: "ACTIVE" })).total).toBe(2);
    expect((await listClients(owner, { status: "ARCHIVED" })).rows.map((c) => c.id)).toEqual([
      first.id,
    ]);
    expect((await listClients(owner, { status: "ALL" })).total).toBe(3);
    await setClientArchived(owner, first.id, false);
    expect((await listClients(owner, { status: "ACTIVE" })).total).toBe(3);
  });

  it("soft deletes a client together with its projects", async () => {
    const { owner } = await setup();
    const client = await createClient(owner, { name: "Doomed Inc" });
    const project = await createProject(owner, client.id, projectInput);
    await deleteClient(owner, client.id);
    await expect(getClient(owner, client.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProject(owner, project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listClients(owner)).total).toBe(0);
    const row = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(row.deletedAt).not.toBeNull();
    const proj = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(proj.deletedAt).not.toBeNull();
  });

  it("enforces roles: members edit but cannot delete", async () => {
    const { member, admin } = await setup();
    const client = await createClient(member, { name: "Member Made" });
    await updateClient(member, client.id, { name: "Member Edited" });
    await expect(deleteClient(member, client.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteClient(admin, client.id)).resolves.toBeUndefined();
  });

  it("client users cannot use the agency lists", async () => {
    const { agency } = await setup();
    const ctx = { userId: "u", agencyId: agency.id, role: "CLIENT" as const, clientIds: [] };
    await expect(listClients(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listProjects(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("plan limits", () => {
  it("blocks the sixth client on STARTER with an upgrade message", async () => {
    const { owner } = await setup("STARTER");
    for (let i = 1; i <= 5; i++) await createClient(owner, { name: `Client ${i}` });
    const error = await createClient(owner, { name: "Client 6" }).catch((e) => e);
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toBe(
      "Your Starter plan allows up to 5 clients. Upgrade your plan to add more.",
    );
    expect(await prisma.client.count({ where: { agencyId: owner.agencyId } })).toBe(5);
  });

  it("archived clients do not count, and restoring is also limited", async () => {
    const { owner } = await setup("STARTER");
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push((await createClient(owner, { name: `Client ${i}` })).id);
    await setClientArchived(owner, ids[0]!, true);
    const sixth = await createClient(owner, { name: "Client 6" });
    expect(sixth.id).toBeTruthy();
    await expect(setClientArchived(owner, ids[0]!, false)).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it("blocks projects over the limit", async () => {
    const { owner } = await setup("STARTER");
    const client = await createClient(owner, { name: "Project Heavy" });
    for (let i = 1; i <= 5; i++)
      await createProject(owner, client.id, { ...projectInput, domain: `site${i}.com` });
    await expect(
      createProject(owner, client.id, { ...projectInput, domain: "site6.com" }),
    ).rejects.toThrow(/Starter plan allows up to 5 projects/);
  });

  it("does not limit the AGENCY plan clients (-1)", async () => {
    const { owner } = await setup("AGENCY");
    for (let i = 1; i <= 7; i++) await createClient(owner, { name: `Client ${i}` });
    expect((await listClients(owner)).total).toBe(7);
  });
});

describe("projects", () => {
  it("normalizes the domain and stores market settings", async () => {
    const { owner } = await setup();
    const client = await createClient(owner, { name: "Acme" });
    const created = await createProject(owner, client.id, projectInput);
    const project = await getProject(owner, created.id);
    expect(project).toMatchObject({
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
      device: "DESKTOP",
      rankCheckFrequency: "DAILY",
      client: { id: client.id, name: "Acme" },
    });
    await updateProject(owner, created.id, {
      ...projectInput,
      name: "Renamed",
      device: "MOBILE",
      rankCheckFrequency: "WEEKLY",
    });
    expect(await getProject(owner, created.id)).toMatchObject({
      name: "Renamed",
      device: "MOBILE",
      rankCheckFrequency: "WEEKLY",
    });
  });

  it("rejects bad domains, unknown countries and languages", async () => {
    const { owner } = await setup();
    const client = await createClient(owner, { name: "Acme" });
    await expect(
      createProject(owner, client.id, { ...projectInput, domain: "localhost" }),
    ).rejects.toMatchObject({
      fieldErrors: { domain: expect.any(String) },
    });
    await expect(
      createProject(owner, client.id, { ...projectInput, locationCode: 1 }),
    ).rejects.toMatchObject({
      fieldErrors: { locationCode: expect.any(String) },
    });
    await expect(
      createProject(owner, client.id, { ...projectInput, languageCode: "xx" }),
    ).rejects.toMatchObject({
      fieldErrors: { languageCode: expect.any(String) },
    });
  });

  it("does not allow the same domain twice for one client, but allows it for another", async () => {
    const { owner } = await setup();
    const a = await createClient(owner, { name: "A Client" });
    const b = await createClient(owner, { name: "B Client" });
    await createProject(owner, a.id, projectInput);
    await expect(
      createProject(owner, a.id, { ...projectInput, domain: "EXAMPLE.com" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(createProject(owner, b.id, projectInput)).resolves.toBeTruthy();
  });

  it("will not add a project to an archived or missing client", async () => {
    const { owner } = await setup();
    const client = await createClient(owner, { name: "Sleepy" });
    await setClientArchived(owner, client.id, true);
    await expect(createProject(owner, client.id, projectInput)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(createProject(owner, "no-such-client", projectInput)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("lists by client and search, and soft deletes", async () => {
    const { owner, member } = await setup();
    const a = await createClient(owner, { name: "A Client" });
    const b = await createClient(owner, { name: "B Client" });
    const p1 = await createProject(owner, a.id, {
      ...projectInput,
      name: "Shop",
      domain: "shop.example.com",
    });
    await createProject(owner, b.id, { ...projectInput, name: "Blog", domain: "blog.example.com" });
    expect((await listProjects(owner)).total).toBe(2);
    expect((await listProjects(owner, { clientId: a.id })).rows.map((p) => p.name)).toEqual([
      "Shop",
    ]);
    expect((await listProjects(owner, { q: "blog" })).rows.map((p) => p.name)).toEqual(["Blog"]);
    await expect(deleteProject(member, p1.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteProject(owner, p1.id);
    await expect(getProject(owner, p1.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listProjects(owner)).total).toBe(1);
  });
});
