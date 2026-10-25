import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createContentTasks,
  deleteContentUpdate,
  getDecayingPages,
  getLinkSuggestions,
  listContentForExport,
  listContentInventory,
  listContentUpdates,
  logContentUpdate,
} from "@/server/services/content";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/services/errors";
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

const day = (v: string) => new Date(`${v}T00:00:00Z`);
const TODAY = new Date("2026-03-10T12:00:00Z");

async function setup(name?: string, withAudit = true) {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    name,
    "GROWTH",
  );
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Acme Dental" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Site",
      domain: "acmedental.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  const s = { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
  if (withAudit) await seedAudit(s);
  return s;
}
type S = Awaited<ReturnType<typeof setup>>;

const url = (path: string) => `https://acmedental.com${path}`;

async function seedAudit(s: S) {
  const audit = await prisma.audit.create({
    data: {
      agencyId: s.agency.id,
      projectId: s.project.id,
      status: "COMPLETED",
      maxPages: 50,
      pagesCrawled: 5,
      healthScore: 80,
      finishedAt: new Date("2026-03-09T10:00:00Z"),
    },
  });
  const page = (path: string, o: Record<string, unknown>) => ({
    agencyId: s.agency.id,
    auditId: audit.id,
    url: url(path),
    statusCode: 200,
    title: path === "/" ? "Home" : `Page ${path}`,
    loadTimeMs: 900,
    wordCount: 800,
    issueCount: 0,
    ...o,
  });
  await prisma.auditPage.createMany({
    data: [
      page("/", { inlinks: 80, lastModified: day("2026-02-01"), issueCount: 1 }),
      page("/pricing", { inlinks: 12, lastModified: day("2024-01-10"), issueCount: 2 }),
      page("/blog/dental-implants-guide", {
        inlinks: 25,
        lastModified: day("2026-01-05"),
        title: "Dental implants guide",
      }),
      page("/implants", {
        inlinks: 1,
        lastModified: null,
        wordCount: 120,
        issueCount: 1,
        title: "Implants",
      }),
      page("/faq", { inlinks: 3, lastModified: day("2025-12-01"), wordCount: 600 }),
    ],
  });
  await prisma.auditIssue.createMany({
    data: [
      {
        agencyId: s.agency.id,
        auditId: audit.id,
        code: "thin_content",
        severity: "WARNING",
        url: url("/implants"),
      },
      {
        agencyId: s.agency.id,
        auditId: audit.id,
        code: "duplicate_content",
        severity: "WARNING",
        url: url("/faq"),
      },
    ],
  });
  const row = (
    key: string,
    period: string,
    clicks: number,
    impressions = clicks * 20,
    position = 90,
  ) => ({
    agencyId: s.agency.id,
    projectId: s.project.id,
    dimension: "PAGE",
    period,
    key,
    clicks,
    impressions,
    positionTenths: position,
  });
  await prisma.searchBreakdown.createMany({
    data: [
      row("https://www.acmedental.com/pricing", "NOW", 30, 600, 110),
      row("https://www.acmedental.com/pricing", "BEFORE", 100, 2000, 80),
      row("https://www.acmedental.com/", "NOW", 400),
      row("https://www.acmedental.com/", "BEFORE", 380),
      row("https://www.acmedental.com/faq", "NOW", 3),
      row("https://www.acmedental.com/faq", "BEFORE", 10),
    ],
  });
  await prisma.keyword.createMany({
    data: [
      {
        agencyId: s.agency.id,
        projectId: s.project.id,
        phrase: "dental implants",
        currentPosition: 9,
        currentUrl: url("/implants"),
        lastCheckedOn: day("2026-03-09"),
      },
      {
        agencyId: s.agency.id,
        projectId: s.project.id,
        phrase: "dental pricing",
        currentPosition: 3,
        currentUrl: url("/pricing"),
        lastCheckedOn: day("2026-03-09"),
      },
    ],
  });
  return audit.id;
}

describe("content inventory", () => {
  it("shows pages with traffic, age and what needs attention", async () => {
    const s = await setup();
    const inv = (await listContentInventory(s.owner, s.project.id, {}, TODAY))!;
    expect(inv.auditOn).toBe("2026-03-09");
    expect(inv.summary).toEqual({
      pages: 5,
      decaying: 1,
      stale: 1,
      thin: 1,
      duplicate: 1,
      unknownAge: 1,
    });
    const byPath = Object.fromEntries(inv.rows.map((r) => [new URL(r.url).pathname, r]));
    expect(byPath["/pricing"]).toMatchObject({
      clicks: 30,
      clicksBefore: 100,
      freshness: "stale",
      flags: ["decaying", "stale"],
      keywords: ["dental pricing"],
    });
    expect(byPath["/implants"]).toMatchObject({
      freshness: "unknown",
      flags: ["thin"],
      keywords: ["dental implants"],
      clicks: null,
    });
    expect(byPath["/faq"]).toMatchObject({ flags: ["duplicate"] });
    expect(byPath["/"]).toMatchObject({ flags: [], clicks: 400, freshness: "fresh" });
  });

  it("filters, sorts and pages", async () => {
    const s = await setup();
    const show = async (filter: "decaying" | "stale" | "thin" | "duplicate") =>
      (await listContentInventory(s.owner, s.project.id, { filter }, TODAY))!.rows.map(
        (r) => new URL(r.url).pathname,
      );
    expect(await show("decaying")).toEqual(["/pricing"]);
    expect(await show("stale")).toEqual(["/pricing"]);
    expect(await show("thin")).toEqual(["/implants"]);
    expect(await show("duplicate")).toEqual(["/faq"]);
    const sorted = async (sort: "issues" | "words" | "oldest" | "links" | "url") =>
      (await listContentInventory(s.owner, s.project.id, { sort }, TODAY))!.rows.map(
        (r) => new URL(r.url).pathname,
      );
    expect((await sorted("issues"))[0]).toBe("/pricing");
    expect((await sorted("words"))[0]).toBe("/implants");
    expect((await sorted("oldest"))[0]).toBe("/pricing");
    expect((await sorted("oldest")).at(-1)).toBe("/implants");
    expect((await sorted("links"))[0]).toBe("/implants");
    const page2 = await listContentInventory(
      s.owner,
      s.project.id,
      { page: 2, pageSize: 2, sort: "url" },
      TODAY,
    );
    expect(page2!.total).toBe(5);
    expect(page2!.rows).toHaveLength(2);
    const search = await listContentInventory(s.owner, s.project.id, { q: "IMPLANTS" }, TODAY);
    expect(search!.total).toBe(2);
  });

  it("exports every page and says nothing without an audit", async () => {
    const s = await setup();
    expect(
      (await listContentForExport(s.owner, s.project.id, TODAY)).map(
        (r) => new URL(r.url).pathname,
      ),
    ).toEqual(["/", "/blog/dental-implants-guide", "/faq", "/implants", "/pricing"]);
    const bare = await setup("Bare Agency", false);
    expect(await listContentInventory(bare.owner, bare.project.id, {}, TODAY)).toBeNull();
    expect(await listContentForExport(bare.owner, bare.project.id, TODAY)).toEqual([]);
  });

  it("stays inside the agency and away from client users", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    await expect(listContentInventory(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    await expect(getDecayingPages(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    await expect(
      listContentInventory({ ...a.owner, role: "CLIENT" }, a.project.id),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("decay and link ideas", () => {
  it("lists pages that lost 30% or more of their clicks, biggest loss first", async () => {
    const s = await setup();
    expect(await getDecayingPages(s.owner, s.project.id)).toEqual([
      {
        url: "https://www.acmedental.com/pricing",
        clicks: 30,
        clicksBefore: 100,
        percent: 70,
        lost: 70,
        keywords: ["dental pricing"],
      },
    ]);
  });

  it("suggests links to a weak page that could grow, from related strong pages", async () => {
    const s = await setup();
    const ideas = await getLinkSuggestions(s.owner, s.project.id);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({
      target: url("/implants"),
      inlinks: 1,
      keyword: "dental implants",
    });
    expect(ideas[0]!.from.map((f) => f.url)).toEqual([url("/blog/dental-implants-guide")]);
  });
});

describe("update tasks", () => {
  it("makes one task per page with the reason, and skips pages that already have an open task", async () => {
    const s = await setup();
    const first = await createContentTasks(
      s.member,
      s.project.id,
      { urls: [url("/pricing"), url("/implants")] },
      TODAY,
    );
    expect(first).toEqual({ created: 2, existing: 0 });
    const tasks = await prisma.task.findMany({
      where: { projectId: s.project.id },
      orderBy: { title: "asc" },
    });
    expect(tasks.map((t) => t.title)).toEqual([
      "Refresh page: /implants",
      "Refresh page: /pricing",
    ]);
    const pricing = tasks[1]!;
    expect(pricing.priority).toBe("HIGH");
    expect(pricing.dueOn?.toISOString().slice(0, 10)).toBe("2026-03-24");
    expect(pricing.description).toContain("losing traffic, out of date");
    expect(pricing.description).toContain("30 in the last 28 days, 100 in the 28 days before");
    expect(tasks[0]!.priority).toBe("MEDIUM");

    expect(
      await createContentTasks(
        s.member,
        s.project.id,
        { urls: [url("/pricing"), url("/faq")] },
        TODAY,
      ),
    ).toEqual({ created: 1, existing: 1 });
    await prisma.task.updateMany({
      where: { title: "Refresh page: /pricing" },
      data: { status: "DONE" },
    });
    expect(
      await createContentTasks(s.member, s.project.id, { urls: [url("/pricing")] }, TODAY),
    ).toEqual({ created: 1, existing: 0 });
  });

  it("refuses other websites, empty lists and too many pages, and checks permission and agency", async () => {
    const s = await setup();
    await expect(
      createContentTasks(s.owner, s.project.id, { urls: ["https://evil.com/x"] }),
    ).rejects.toThrow(ValidationError);
    await expect(createContentTasks(s.owner, s.project.id, { urls: [] })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      createContentTasks(s.owner, s.project.id, {
        urls: Array.from({ length: 21 }, (_, i) => url(`/p${i}`)),
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createContentTasks({ ...s.owner, role: "CLIENT" }, s.project.id, { urls: [url("/")] }),
    ).rejects.toThrow(ForbiddenError);
    const other = await setup("Other Agency");
    await expect(
      createContentTasks(other.owner, s.project.id, { urls: [url("/")] }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("did the update help", () => {
  it("keeps the numbers from just before, waits 14 days, then compares", async () => {
    const s = await setup();
    const logged = await logContentUpdate(
      s.member,
      s.project.id,
      { url: url("/pricing"), updatedOn: "2026-03-08", note: "New section" },
      TODAY,
    );
    expect(logged.hadTraffic).toBe(true);
    const row = await prisma.contentUpdate.findUniqueOrThrow({ where: { id: logged.id } });
    expect(row).toMatchObject({
      baselineClicks: 30,
      baselineImpressions: 600,
      baselinePositionTenths: 110,
    });
    const [early] = await listContentUpdates(s.owner, s.project.id, TODAY);
    expect(early!.result).toEqual({ ready: false, daysSince: 2, daysLeft: 12 });

    // A page that had no traffic gets a zero baseline.
    const second = await logContentUpdate(
      s.member,
      s.project.id,
      { url: url("/implants"), updatedOn: "2026-02-01" },
      TODAY,
    );
    expect(second.hadTraffic).toBe(false);
    const list = await listContentUpdates(s.owner, s.project.id, TODAY);
    expect(list.map((u) => u.updatedOn)).toEqual(["2026-03-08", "2026-02-01"]);
    expect(list[1]!.result).toMatchObject({ ready: true, partial: false, verdict: "same" });

    // Traffic has grown since the first update, 20 days later.
    const later = new Date("2026-03-28T12:00:00Z");
    await prisma.searchBreakdown.updateMany({
      where: { projectId: s.project.id, key: "https://www.acmedental.com/pricing", period: "NOW" },
      data: { clicks: 60, positionTenths: 90 },
    });
    const [after] = await listContentUpdates(s.owner, s.project.id, later);
    expect(after!.result).toMatchObject({
      ready: true,
      partial: true,
      clicksChange: 100,
      verdict: "better",
      positionChangeTenths: 20,
    });
  });

  it("refuses other websites, future days and bad input, and checks permission and agency", async () => {
    const s = await setup();
    const bad = (o: object) =>
      logContentUpdate(
        s.owner,
        s.project.id,
        { url: url("/pricing"), updatedOn: "2026-03-08", ...o },
        TODAY,
      );
    await expect(bad({ url: "https://evil.com/" })).rejects.toThrow(ValidationError);
    await expect(bad({ url: "" })).rejects.toThrow(ValidationError);
    await expect(bad({ updatedOn: "2026-03-20" })).rejects.toThrow(/future/);
    await expect(bad({ updatedOn: "2026-13-01" })).rejects.toThrow(ValidationError);
    await expect(
      logContentUpdate(
        { ...s.owner, role: "CLIENT" },
        s.project.id,
        { url: url("/"), updatedOn: "2026-03-08" },
        TODAY,
      ),
    ).rejects.toThrow(ForbiddenError);
    const other = await setup("Other Agency");
    await expect(
      logContentUpdate(
        other.owner,
        s.project.id,
        { url: url("/"), updatedOn: "2026-03-08" },
        TODAY,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("deletes only with permission and inside the agency", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    const { id } = await logContentUpdate(
      s.member,
      s.project.id,
      { url: url("/"), updatedOn: "2026-03-01" },
      TODAY,
    );
    await expect(deleteContentUpdate(s.member, s.project.id, id)).rejects.toThrow(ForbiddenError);
    await expect(deleteContentUpdate(other.owner, other.project.id, id)).rejects.toThrow(
      NotFoundError,
    );
    await deleteContentUpdate(s.owner, s.project.id, id);
    expect(await listContentUpdates(s.owner, s.project.id, TODAY)).toEqual([]);
  });
});
