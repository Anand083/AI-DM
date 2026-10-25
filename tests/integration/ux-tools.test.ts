import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bulkSetClientsArchived, bulkUpdateTasks } from "@/server/services/bulk";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/services/errors";
import {
  createSavedView,
  deleteSavedView,
  getHiddenDashboardParts,
  listSavedViews,
  setHiddenDashboardParts,
} from "@/server/services/saved-views";
import { globalSearch } from "@/server/services/search";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
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
    ["OWNER", "MEMBER"],
    undefined,
    plan,
  );
  return { agency, owner: members[0]!.ctx, member: members[1]!.ctx };
}

describe("global search", () => {
  it("finds clients, projects, keywords and tasks of this agency only", async () => {
    const a = await setup();
    const b = await setup();
    for (const [s, tag] of [
      [a, "zebra"],
      [b, "zebra"],
    ] as const) {
      const client = await prisma.client.create({
        data: { agencyId: s.agency.id, name: `Zebra Co ${s.agency.id.slice(0, 4)}` },
      });
      const project = await prisma.project.create({
        data: {
          agencyId: s.agency.id,
          clientId: client.id,
          name: `${tag} site`,
          domain: `${tag}.example.com`,
          locationCode: 2840,
          languageCode: "en",
        },
      });
      await prisma.keyword.create({
        data: { agencyId: s.agency.id, projectId: project.id, phrase: `buy ${tag} socks` },
      });
      await prisma.task.create({ data: { agencyId: s.agency.id, title: `Fix ${tag} page` } });
    }
    const out = await globalSearch(a.owner, "  ZEBRA ");
    expect(out.query).toBe("ZEBRA");
    expect(out.clients).toHaveLength(1);
    expect(out.projects).toHaveLength(1);
    expect(out.keywords).toHaveLength(1);
    expect(out.keywords[0]!.detail).toContain("not ranked");
    expect(out.tasks).toHaveLength(1);
    expect(out.clients[0]!.path).toMatch(/^\/clients\//);
  });

  it("ignores short text, deleted data and client users", async () => {
    const s = await setup();
    const client = await prisma.client.create({
      data: { agencyId: s.agency.id, name: "Gone Co", deletedAt: new Date() },
    });
    expect(client.id).toBeTruthy();
    expect((await globalSearch(s.owner, "g")).clients).toEqual([]);
    expect((await globalSearch(s.owner, "Gone")).clients).toEqual([]);
    expect((await globalSearch(s.owner, undefined)).query).toBeNull();
    await expect(globalSearch({ ...s.owner, role: "CLIENT" }, "Gone")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("saved views", () => {
  it("are private to the person and keep only allowed filters", async () => {
    const s = await setup();
    await createSavedView(s.owner, {
      scope: "tasks",
      name: "My overdue",
      params: { view: "overdue", q: "seo", hack: "x" },
    });
    const mine = await listSavedViews(s.owner, "tasks");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.params).toEqual({ view: "overdue", q: "seo" });
    expect(await listSavedViews(s.member, "tasks")).toEqual([]);
    expect(await listSavedViews(s.owner, "clients")).toEqual([]);
    expect(await listSavedViews(s.owner, "nonsense")).toEqual([]);
    await expect(deleteSavedView(s.member, mine[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteSavedView(s.owner, mine[0]!.id);
    expect(await listSavedViews(s.owner, "tasks")).toEqual([]);
  });

  it("need a name, a filter and a known list", async () => {
    const s = await setup();
    await expect(
      createSavedView(s.owner, { scope: "tasks", name: "x", params: { q: "a" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createSavedView(s.owner, { scope: "tasks", name: "Empty", params: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createSavedView(s.owner, { scope: "billing", name: "Nope", params: { q: "a" } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("are limited to 20 per list", async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++)
      await createSavedView(s.owner, {
        scope: "clients",
        name: `View ${i}`,
        params: { q: `q${i}` },
      });
    await expect(
      createSavedView(s.owner, { scope: "clients", name: "One more", params: { q: "z" } }),
    ).rejects.toThrow(/up to 20/);
  });
});

describe("dashboard parts", () => {
  it("remembers hidden parts per person", async () => {
    const s = await setup();
    expect(await getHiddenDashboardParts(s.owner)).toEqual([]);
    await setHiddenDashboardParts(s.owner, { hidden: ["usage", "alerts", "usage"] });
    expect((await getHiddenDashboardParts(s.owner)).sort()).toEqual(["alerts", "usage"]);
    expect(await getHiddenDashboardParts(s.member)).toEqual([]);
    await setHiddenDashboardParts(s.owner, { hidden: [] });
    expect(await getHiddenDashboardParts(s.owner)).toEqual([]);
    await expect(setHiddenDashboardParts(s.owner, { hidden: ["secrets"] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("bulk actions", () => {
  it("archive and restore clients, and report the ones that fail", async () => {
    const s = await setup("STARTER");
    const other = await setup();
    const mine = await Promise.all(
      ["A", "B"].map((n) =>
        prisma.client.create({ data: { agencyId: s.agency.id, name: `Bulk ${n}` } }),
      ),
    );
    const foreign = await prisma.client.create({
      data: { agencyId: other.agency.id, name: "Foreign" },
    });
    const out = await bulkSetClientsArchived(s.owner, {
      ids: [...mine.map((c) => c.id), foreign.id],
      archived: true,
    });
    expect(out.done).toBe(2);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]!.id).toBe(foreign.id);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
      "ACTIVE",
    );
    const back = await bulkSetClientsArchived(s.owner, {
      ids: mine.map((c) => c.id),
      archived: false,
    });
    expect(back.done).toBe(2);
    await expect(
      bulkSetClientsArchived(s.owner, { ids: [], archived: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      bulkSetClientsArchived(
        { ...s.owner, role: "CLIENT" },
        { ids: [mine[0]!.id], archived: true },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("update tasks through the normal rules", async () => {
    const s = await setup();
    const tasks = await Promise.all(
      [1, 2, 3].map((n) => prisma.task.create({ data: { agencyId: s.agency.id, title: `T${n}` } })),
    );
    const done = await bulkUpdateTasks(s.owner, {
      ids: tasks.slice(0, 2).map((t) => t.id),
      action: "done",
    });
    expect(done.done).toBe(2);
    const rows = await prisma.task.findMany({
      where: { agencyId: s.agency.id },
      orderBy: { title: "asc" },
    });
    expect(rows.map((r) => r.status)).toEqual(["DONE", "DONE", "TODO"]);
    expect(rows[0]!.completedAt).not.toBeNull();
    await bulkUpdateTasks(s.owner, { ids: [tasks[2]!.id], action: "high" });
    await bulkUpdateTasks(s.owner, { ids: [tasks[2]!.id], action: "assign_me" });
    const last = await prisma.task.findUniqueOrThrow({ where: { id: tasks[2]!.id } });
    expect(last.priority).toBe("HIGH");
    expect(last.assigneeId).toBe(s.owner.userId);
    const strange = await bulkUpdateTasks(s.owner, { ids: ["nope"], action: "done" });
    expect(strange.failed).toHaveLength(1);
  });
});
