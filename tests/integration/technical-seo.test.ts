import IORedis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { RedisLockStore } from "@/server/locks";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import { pollAudit, runAuditStart, type RunnerDeps } from "@/server/services/audit-runner";
import { getAuditConfig, saveAuditConfig } from "@/server/services/audit-config";
import { setIssueState } from "@/server/services/audit-issue-state";
import {
  createAudit,
  getAuditDiagnostics,
  getIssueGroups,
  getPageChanges,
  listAuditPages,
} from "@/server/services/audits";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/services/errors";
import { SeoGateway } from "@/server/services/seo-gateway";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");
let clock = new Date("2026-03-10T10:00:00Z");
const advance = (seconds: number) => void (clock = new Date(clock.getTime() + seconds * 1000));

function makeDeps() {
  const provider = new MockSeoProvider({ now: () => clock, auditSeconds: 20 });
  const polls: { auditId: string; agencyId: string; attempt: number }[] = [];
  const deps: RunnerDeps = {
    db,
    gateway: new SeoGateway({
      provider: () => provider,
      db: prisma,
      locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
      now: () => clock,
    }),
    enqueuePoll: async (d) => void polls.push(d),
    now: () => clock,
  };
  return { deps, polls };
}

async function setup(name?: string) {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    name,
    "GROWTH",
  );
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Client" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Site",
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

async function runAudit(s: S, deps: RunnerDeps, polls: { attempt: number }[]) {
  const audit = await createAudit(s.owner, s.project.id, s.owner.userId, async () => {});
  await runAuditStart(deps, { auditId: audit.id, agencyId: s.agency.id });
  advance(30);
  await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: polls.length || 1 });
  return audit.id;
}

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
beforeEach(() => {
  clock = new Date("2026-03-10T10:00:00Z");
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("crawl settings", () => {
  it("start with defaults, save a cleaned list, and refuse bad input", async () => {
    const s = await setup();
    expect(await getAuditConfig(s.owner, s.project.id)).toEqual({
      excludePaths: [],
      respectRobots: true,
      mobile: false,
    });
    await saveAuditConfig(s.member, s.project.id, {
      excludePaths: ["cart", "/account", "cart", " /blog/tag "],
      respectRobots: false,
      mobile: true,
    });
    expect(await getAuditConfig(s.owner, s.project.id)).toEqual({
      excludePaths: ["/account", "/blog/tag", "/cart"],
      respectRobots: false,
      mobile: true,
    });
    await expect(
      saveAuditConfig(s.owner, s.project.id, { excludePaths: ["/ba d"] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      saveAuditConfig(s.owner, s.project.id, {
        excludePaths: Array.from({ length: 21 }, (_, i) => `/p${i}`),
      }),
    ).rejects.toThrow(ValidationError);
    await expect(saveAuditConfig({ ...s.owner, role: "CLIENT" }, s.project.id, {})).rejects.toThrow(
      ForbiddenError,
    );
    await expect(getAuditConfig({ ...s.owner, role: "CLIENT" }, s.project.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("stays inside the agency", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    await expect(saveAuditConfig(b.owner, a.project.id, {})).rejects.toThrow(NotFoundError);
    await expect(getAuditConfig(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
  });
});

describe("a crawl with the new checks", () => {
  it("saves vitals, redirect details and robots and sitemap findings", async () => {
    const s = await setup();
    const { deps, polls } = makeDeps();
    const id = await runAudit(s, deps, polls);
    const pages = await prisma.auditPage.findMany({ where: { auditId: id }, take: 500 });
    expect(pages.length).toBeGreaterThan(5);
    expect(pages.every((p) => p.lcpMs !== null && p.cls !== null && p.inpMs !== null)).toBe(true);
    const diagnostics = await getAuditDiagnostics(s.owner, s.project.id, id);
    expect(diagnostics).not.toBeNull();
    expect(typeof diagnostics!.robots.found).toBe("boolean");
    expect(diagnostics!.sitemap.urls).toBeGreaterThanOrEqual(0);
    const list = await listAuditPages(s.owner, s.project.id, id, { pageSize: 5 });
    expect(list.rows[0]).toHaveProperty("lcpMs");
  });

  it("leaves out the paths the project skips (the home page always stays)", async () => {
    const s = await setup();
    const { deps, polls } = makeDeps();
    const first = await runAudit(s, deps, polls);
    const all = await prisma.auditPage.findMany({ where: { auditId: first }, take: 500 });
    const skipped = (u: string) => new URL(u).pathname.startsWith("/blog");
    expect(all.some((p) => skipped(p.url))).toBe(true);

    await saveAuditConfig(s.owner, s.project.id, { excludePaths: ["/blog"] });
    const second = await runAudit(s, deps, polls);
    const kept = await prisma.auditPage.findMany({ where: { auditId: second }, take: 500 });
    expect(kept.some((p) => skipped(p.url))).toBe(false);
    expect(kept.some((p) => new URL(p.url).pathname === "/")).toBe(true);
    expect(kept.length).toBeLessThan(all.length);
    const issueUrls = await prisma.auditIssue.findMany({ where: { auditId: second }, take: 5000 });
    expect(issueUrls.some((i) => skipped(i.url))).toBe(false);

    const changes = await getPageChanges(s.owner, s.project.id, second);
    expect(changes!.removed.length).toBeGreaterThan(0);
    expect(changes!.removed.every(skipped)).toBe(true);
    expect(changes!.added).toEqual([]);
  });
});

describe("issue marks", () => {
  it("ignores and resolves issues in bulk, and reopens a fixed one that comes back", async () => {
    const s = await setup();
    const { deps, polls } = makeDeps();
    const first = await runAudit(s, deps, polls);
    const groups = await getIssueGroups(s.owner, s.project.id, first);
    expect(groups.length).toBeGreaterThan(2);
    const [ignoreMe, fixMe] = [groups[0]!, groups[1]!];

    const ignored = await setIssueState(s.member, s.project.id, {
      auditId: first,
      code: ignoreMe.code,
      status: "IGNORED",
      note: "Intended",
    });
    expect(ignored.changed).toBe(ignoreMe.count);
    const fixed = await setIssueState(s.member, s.project.id, {
      auditId: first,
      code: fixMe.code,
      status: "RESOLVED",
    });
    expect(fixed.changed).toBe(fixMe.count);

    const after = await getIssueGroups(s.owner, s.project.id, first);
    expect(after.find((g) => g.code === ignoreMe.code)).toMatchObject({
      ignored: ignoreMe.count,
      resolved: 0,
    });
    expect(after.find((g) => g.code === fixMe.code)).toMatchObject({
      ignored: 0,
      resolved: fixMe.count,
    });

    // The same site is found again, so the "fixed" mark opens again and the "ignore" stays.
    const second = await runAudit(s, deps, polls);
    const again = await getIssueGroups(s.owner, s.project.id, second);
    expect(again.find((g) => g.code === fixMe.code)).toMatchObject({ resolved: 0 });
    expect(again.find((g) => g.code === ignoreMe.code)).toMatchObject({
      ignored: ignoreMe.count,
    });

    // Putting an issue back removes the mark.
    await setIssueState(s.owner, s.project.id, {
      auditId: second,
      code: ignoreMe.code,
      status: "OPEN",
    });
    expect(
      await prisma.auditIssueState.count({
        where: { projectId: s.project.id, code: ignoreMe.code },
      }),
    ).toBe(0);
  });

  it("marks only chosen pages, and only pages that really have the issue", async () => {
    const s = await setup();
    const { deps, polls } = makeDeps();
    const id = await runAudit(s, deps, polls);
    const group = (await getIssueGroups(s.owner, s.project.id, id))[0]!;
    const result = await setIssueState(s.owner, s.project.id, {
      auditId: id,
      code: group.code,
      status: "IGNORED",
      urls: [group.sampleUrls[0]!, "https://example.com/not-an-issue"],
    });
    expect(result.changed).toBe(1);
  });

  it("checks permission and agency", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    const { deps, polls } = makeDeps();
    const id = await runAudit(a, deps, polls);
    const group = (await getIssueGroups(a.owner, a.project.id, id))[0]!;
    const input = { auditId: id, code: group.code, status: "IGNORED" };
    await expect(
      setIssueState({ ...a.owner, role: "CLIENT" }, a.project.id, input),
    ).rejects.toThrow(ForbiddenError);
    await expect(setIssueState(b.owner, a.project.id, input)).rejects.toThrow(NotFoundError);
    await expect(
      setIssueState(a.owner, a.project.id, { ...input, status: "DELETED" }),
    ).rejects.toThrow(ValidationError);
  });
});
