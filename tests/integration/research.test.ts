import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  addResearchToTracker,
  deleteKeywordList,
  getKeywordList,
  IDEAS_PER_SEARCH,
  listKeywordListItems,
  listKeywordListItemsForExport,
  listKeywordLists,
  removeListItems,
  renameKeywordList,
  saveToList,
  searchKeywordIdeas,
} from "@/server/services/research";
import { getQueues } from "@/server/jobs/queues";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const search = { seed: "Dental Implants", locationCode: 2840, languageCode: "en" };

async function setup(plan = "GROWTH") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
    plan,
  );
  return { agency, owner: members[0]!.ctx, admin: members[1]!.ctx, member: members[2]!.ctx };
}

const item = (phrase: string, volume = 100) => ({
  phrase,
  volume,
  cpcMicros: 1_500_000,
  difficulty: 40,
  intent: "commercial",
  locationCode: 2840,
  languageCode: "en",
});

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await Promise.all(Object.values(getQueues()).map((q) => q.close()));
  await prisma.$disconnect();
});

describe("searching", () => {
  it("returns up to 100 ideas, starting with the seed", async () => {
    const { owner } = await setup();
    const { ideas, cached } = await searchKeywordIdeas(owner, {
      seed: "Brand New Seed Phrase",
      locationCode: 2840,
      languageCode: "en",
    });
    expect(cached).toBe(false);
    expect(ideas.length).toBeGreaterThan(5);
    expect(ideas.length).toBeLessThanOrEqual(IDEAS_PER_SEARCH);
    expect(ideas[0]!.keyword).toBe("brand new seed phrase");
  });

  it("answers a repeat search from the cache: no new usage record", async () => {
    const { owner, agency } = await setup();
    const first = await searchKeywordIdeas(owner, { ...search, seed: "unique cache check seed" });
    const second = await searchKeywordIdeas(owner, {
      ...search,
      seed: "  Unique   Cache Check SEED ",
    });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.ideas).toEqual(first.ideas);
    const usage = await prisma.usageRecord.findMany({
      where: { agencyId: agency.id, metric: "KEYWORD_RESEARCH" },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ quantity: 1, costMicros: 10_000 });
  });

  it("enforces the monthly limit for new searches but still answers repeats (STARTER: 100)", async () => {
    const { owner, agency } = await setup("STARTER");
    await searchKeywordIdeas(owner, { ...search, seed: "limit test seed one" });
    await prisma.usageRecord.create({
      data: {
        agencyId: agency.id,
        metric: "KEYWORD_RESEARCH",
        quantity: 99,
        costMicros: 0,
        provider: "mock",
        operation: "x",
      },
    });
    const error = await searchKeywordIdeas(owner, { ...search, seed: "limit test seed two" }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toMatch(
      /^You have used all 100 keyword research searches for this month on your Starter plan\./,
    );
    // The first search is saved, so it is free even now.
    await expect(
      searchKeywordIdeas(owner, { ...search, seed: "limit test seed one" }),
    ).resolves.toMatchObject({ cached: true });
    expect(
      await prisma.usageRecord.count({
        where: { agencyId: agency.id, metric: "KEYWORD_RESEARCH" },
      }),
    ).toBe(2);
  });

  it("validates the input", async () => {
    const { owner } = await setup();
    await expect(searchKeywordIdeas(owner, { ...search, seed: "a" })).rejects.toMatchObject({
      fieldErrors: { seed: expect.any(String) },
    });
    await expect(searchKeywordIdeas(owner, { ...search, locationCode: 1 })).rejects.toMatchObject({
      fieldErrors: { locationCode: expect.any(String) },
    });
    await expect(
      searchKeywordIdeas(owner, { ...search, languageCode: "xx" }),
    ).rejects.toMatchObject({ fieldErrors: { languageCode: expect.any(String) } });
  });

  it("members can search, client users cannot", async () => {
    const { member, owner } = await setup();
    await expect(
      searchKeywordIdeas(member, { ...search, seed: "member search seed" }),
    ).resolves.toBeTruthy();
    await expect(searchKeywordIdeas({ ...owner, role: "CLIENT" }, search)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("saved lists", () => {
  it("saves to a new list, then adds more to it, skipping repeats", async () => {
    const { owner, agency } = await setup();
    const first = await saveToList(owner, {
      newListName: "Dentist ideas",
      items: [item("dental implants"), item("implant cost"), item("dental implants")],
    });
    expect(first).toMatchObject({ added: 2, skipped: 0 });
    const second = await saveToList(owner, {
      listId: first.listId,
      items: [item("implant cost"), item("best dentist")],
    });
    expect(second).toMatchObject({ added: 1, skipped: 1 });
    const lists = await listKeywordLists(owner);
    expect(lists).toEqual([
      expect.objectContaining({ id: first.listId, name: "Dentist ideas", itemCount: 3 }),
    ]);
    const { rows, total } = await listKeywordListItems(owner, first.listId);
    expect(total).toBe(3);
    expect(rows.map((r) => r.phrase).sort()).toEqual([
      "best dentist",
      "dental implants",
      "implant cost",
    ]);
    expect(
      await prisma.activityLog.count({ where: { agencyId: agency.id, action: "research.saved" } }),
    ).toBe(2);
  });

  it("needs exactly one of: an existing list or a new name", async () => {
    const { owner } = await setup();
    await expect(saveToList(owner, { items: [item("a b")] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      saveToList(owner, { listId: "x", newListName: "y y", items: [item("a b")] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(saveToList(owner, { newListName: "ok name", items: [] })).rejects.toMatchObject({
      fieldErrors: { items: expect.any(String) },
    });
  });

  it("rejects a name that is already used, and renames", async () => {
    const { owner } = await setup();
    const a = await saveToList(owner, { newListName: "List A", items: [item("one")] });
    await saveToList(owner, { newListName: "List B", items: [item("two")] });
    await expect(
      saveToList(owner, { newListName: "List A", items: [item("three")] }),
    ).rejects.toMatchObject({
      fieldErrors: { newListName: expect.any(String) },
    });
    await renameKeywordList(owner, a.listId, "List A2");
    expect((await getKeywordList(owner, a.listId)).name).toBe("List A2");
    await expect(renameKeywordList(owner, a.listId, "List B")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("removes items, exports, and deletes lists (admins can delete, members cannot)", async () => {
    const { owner, admin, member } = await setup();
    const { listId } = await saveToList(owner, {
      newListName: "Temp",
      items: [item("keep me", 500), item("remove me", 100)],
    });
    const rows = (await listKeywordListItems(owner, listId)).rows;
    expect(rows[0]!.phrase).toBe("keep me"); // highest volume first
    expect(await removeListItems(owner, listId, [rows[1]!.id])).toBe(1);
    expect((await listKeywordListItemsForExport(owner, listId)).map((r) => r.phrase)).toEqual([
      "keep me",
    ]);
    await expect(deleteKeywordList(member, listId)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteKeywordList(admin, listId);
    await expect(getKeywordList(owner, listId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.keywordListItem.count({ where: { listId } })).toBe(0);
  });

  it("is isolated per agency, and client users cannot read lists", async () => {
    const a = await setup();
    const b = await setup();
    const { listId } = await saveToList(a.owner, {
      newListName: "Secret",
      items: [item("secret term")],
    });
    await expect(getKeywordList(b.owner, listId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listKeywordListItems(b.owner, listId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveToList(b.owner, { listId, items: [item("x y")] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeListItems(b.owner, listId, ["whatever"])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteKeywordList(b.owner, listId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listKeywordLists(b.owner)).toEqual([]);
    await expect(listKeywordLists({ ...a.owner, role: "CLIENT" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await prisma.keywordListItem.count({ where: { listId } })).toBe(1);
  });
});

describe("add to rank tracker", () => {
  it("adds researched keywords to a project with the 'research' tag", async () => {
    const { owner, agency } = await setup();
    const client = await prisma.client.create({ data: { agencyId: agency.id, name: "C" } });
    const project = await prisma.project.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: "P",
        domain: "p.com",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    const result = await addResearchToTracker(owner, project.id, [
      "dental implants",
      "implant cost",
      "Dental Implants",
    ]);
    expect(result).toMatchObject({ added: 2, duplicatesInPaste: 1 });
    const rows = await prisma.keyword.findMany({ where: { projectId: project.id } });
    expect(rows.every((r) => r.tags.includes("research"))).toBe(true);
    // Already tracked keywords are skipped.
    expect(
      await addResearchToTracker(owner, project.id, ["implant cost", "new one"]),
    ).toMatchObject({ added: 1, alreadyTracked: 1 });
  });

  it("respects the keyword limit and other agencies' projects", async () => {
    const a = await setup("STARTER");
    const b = await setup();
    const client = await prisma.client.create({ data: { agencyId: a.agency.id, name: "C" } });
    const project = await prisma.project.create({
      data: {
        agencyId: a.agency.id,
        clientId: client.id,
        name: "P",
        domain: "p.com",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    const many = Array.from({ length: 251 }, (_, i) => `term ${i}`);
    await expect(addResearchToTracker(a.owner, project.id, many)).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    await expect(addResearchToTracker(b.owner, project.id, ["x y"])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma.keyword.count({ where: { projectId: project.id } })).toBe(0);
  });
});
