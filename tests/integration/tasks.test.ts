import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { runTaskReminders } from "@/server/jobs/system/task-reminders";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/services/errors";
import {
  addTaskComment,
  createTask,
  createTaskFromIssue,
  deleteTask,
  getTask,
  listAssignees,
  listTasks,
  updateTask,
} from "@/server/services/tasks";
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

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
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
  return {
    agency,
    project,
    owner: members[0]!.ctx,
    admin: members[1]!.ctx,
    member: members[2]!.ctx,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

const now = new Date("2026-03-10T10:00:00Z");

describe("creating and changing tasks", () => {
  it("creates a task with defaults and writes the activity log", async () => {
    const s = await setup();
    const { id } = await createTask(s.member, {
      title: "Write the new homepage text",
      projectId: s.project.id,
    });
    const task = await getTask(s.owner, id);
    expect(task).toMatchObject({
      title: "Write the new homepage text",
      status: "TODO",
      priority: "MEDIUM",
      recurrence: "NONE",
      dueOn: null,
      assigneeId: null,
      project: { id: s.project.id, name: "Site" },
    });
    const log = await prisma.activityLog.findFirst({
      where: { agencyId: s.agency.id, action: "task.created" },
    });
    expect(log?.targetId).toBe(id);
  });

  it("checks the fields with plain messages", async () => {
    const s = await setup();
    const bad = (v: object) => createTask(s.owner, v);
    await expect(bad({ title: "ab" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ title: "A good title", dueOn: "31/03/2026" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ title: "A good title", dueOn: "2026-02-31" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ title: "A good title", estimateMinutes: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ title: "A good title", priority: "SOON" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("only team members of this agency can be assigned, and only own projects used", async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      createTask(a.owner, { title: "Task for a stranger", assigneeId: b.owner.userId }),
    ).rejects.toMatchObject({ fieldErrors: { assigneeId: "Choose a member of your team." } });
    await expect(
      createTask(a.owner, { title: "Task on another project", projectId: b.project.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const { id } = await createTask(a.owner, {
      title: "Task for a member",
      assigneeId: a.member.userId,
    });
    await expect(updateTask(a.owner, id, { assigneeId: b.member.userId })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await listAssignees(a.owner)).map((m) => m.id).sort()).toEqual(
      [a.owner.userId, a.admin.userId, a.member.userId].sort(),
    );
  });

  it("sets and clears the finished time with the status", async () => {
    const s = await setup();
    const { id } = await createTask(s.owner, { title: "Fix the broken links" });
    await updateTask(s.member, id, { status: "IN_PROGRESS" }, now);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).completedAt).toBeNull();
    await updateTask(s.member, id, { status: "DONE" }, now);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).completedAt).toEqual(now);
    await updateTask(s.member, id, { status: "TODO" }, now);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).completedAt).toBeNull();
    expect(await prisma.task.count({ where: { agencyId: s.agency.id } })).toBe(1);
  });

  it("creates the next copy of a repeating task when it is finished", async () => {
    const s = await setup();
    const { id } = await createTask(s.owner, {
      title: "Monthly rank report check",
      recurrence: "MONTHLY",
      dueOn: "2026-03-05",
      assigneeId: s.member.userId,
      priority: "HIGH",
      estimateMinutes: 30,
    });
    const result = await updateTask(s.owner, id, { status: "DONE" }, now);
    expect(result.nextTaskId).toBeTruthy();
    const next = await getTask(s.owner, result.nextTaskId!);
    expect(next).toMatchObject({
      title: "Monthly rank report check",
      status: "TODO",
      recurrence: "MONTHLY",
      dueOn: "2026-04-05",
      assigneeId: s.member.userId,
      priority: "HIGH",
      estimateMinutes: 30,
    });
    // Marking it done again does not make a third copy.
    expect((await updateTask(s.owner, id, { status: "DONE" }, now)).nextTaskId).toBeNull();
    expect(await prisma.task.count({ where: { agencyId: s.agency.id } })).toBe(2);
  });

  it("only owners and admins can delete, and unknown ids are not found", async () => {
    const s = await setup();
    const { id } = await createTask(s.owner, { title: "Task to remove" });
    await expect(deleteTask(s.member, id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteTask(s.admin, id);
    await expect(getTask(s.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTask(s.owner, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("client users have no access", async () => {
    const s = await setup();
    const client = { ...s.owner, role: "CLIENT" as const };
    await expect(createTask(client, { title: "Not allowed" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listTasks(client)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAssignees(client)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("tasks from audit issues", () => {
  async function auditWithIssues(s: S) {
    const audit = await prisma.audit.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        status: "COMPLETED",
        maxPages: 10,
        pagesCrawled: 3,
        healthScore: 70,
        counts: { critical: 2, warning: 0, notice: 0, byCode: { missing_title: 2 } },
        finishedAt: now,
      },
    });
    await prisma.auditIssue.createMany({
      data: ["https://example.com/a", "https://example.com/b"].map((url) => ({
        agencyId: s.agency.id,
        auditId: audit.id,
        code: "missing_title",
        severity: "CRITICAL" as const,
        url,
      })),
    });
    return audit;
  }

  it("makes a task from the catalog text and does not make a second open one", async () => {
    const s = await setup();
    const audit = await auditWithIssues(s);
    const first = await createTaskFromIssue(s.member, s.project.id, audit.id, "missing_title");
    expect(first.existing).toBe(false);
    const task = await getTask(s.owner, first.id);
    expect(task.priority).toBe("HIGH");
    expect(task.sourceIssueCode).toBe("missing_title");
    expect(task.sourceAuditId).toBe(audit.id);
    expect(task.description).toContain("Found on 2 pages");
    expect(task.description).toContain("https://example.com/a");

    const again = await createTaskFromIssue(s.member, s.project.id, audit.id, "missing_title");
    expect(again).toEqual({ id: first.id, existing: true });
    // Once it is done a new one may be made.
    await updateTask(s.owner, first.id, { status: "DONE" }, now);
    expect(
      (await createTaskFromIssue(s.member, s.project.id, audit.id, "missing_title")).existing,
    ).toBe(false);
  });

  it("refuses an issue that is not in the audit, and other agencies' audits", async () => {
    const a = await setup();
    const b = await setup();
    const audit = await auditWithIssues(a);
    await expect(
      createTaskFromIssue(a.owner, a.project.id, audit.id, "no_such_issue"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createTaskFromIssue(b.owner, a.project.id, audit.id, "missing_title"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createTaskFromIssue(b.owner, b.project.id, audit.id, "missing_title"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("comments", () => {
  it("adds comments in order with the author name", async () => {
    const s = await setup();
    const { id } = await createTask(s.owner, { title: "Task with a talk" });
    await addTaskComment(s.owner, id, { body: "First thought" });
    await addTaskComment(s.member, id, { body: "  Second thought  " });
    const task = await getTask(s.owner, id);
    expect(task.comments.map((c) => c.body)).toEqual(["First thought", "Second thought"]);
    expect(task.comments.every((c) => c.author.length > 0 && c.author !== "Someone")).toBe(true);
    await expect(addTaskComment(s.owner, id, { body: "   " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(addTaskComment(s.owner, "nope", { body: "Hello" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("lists", () => {
  it("filters by view, sorts by due day with no date last, and pages", async () => {
    const s = await setup();
    const make = (title: string, extra: object = {}) => createTask(s.owner, { title, ...extra });
    await make("No due day task");
    await make("Later task", { dueOn: "2026-03-20", assigneeId: s.member.userId });
    await make("Overdue task", { dueOn: "2026-03-01", assigneeId: s.owner.userId });
    const done = await make("Finished task", { dueOn: "2026-03-02" });
    await updateTask(s.owner, done.id, { status: "DONE" }, now);

    const titles = async (view: "open" | "mine" | "overdue" | "done", ctx = s.owner) =>
      (await listTasks(ctx, { view }, now)).rows.map((r) => r.title);
    expect(await titles("open")).toEqual(["Overdue task", "Later task", "No due day task"]);
    expect(await titles("overdue")).toEqual(["Overdue task"]);
    expect(await titles("done")).toEqual(["Finished task"]);
    expect(await titles("mine", s.member)).toEqual(["Later task"]);
    expect(await titles("mine", s.owner)).toEqual(["Overdue task"]);

    const page = await listTasks(s.owner, { view: "open", page: 2, pageSize: 2 }, now);
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.title)).toEqual(["No due day task"]);
    expect((await listTasks(s.owner, { q: "later" }, now)).rows).toHaveLength(1);
    expect((await listTasks(s.owner, { projectId: s.project.id }, now)).total).toBe(0);
    const row = (await listTasks(s.owner, { view: "mine" }, now)).rows[0]!;
    expect(row.assignee).toBeTruthy();
  });
});

describe("due reminders", () => {
  it("makes one alert a day for an agency with overdue or due-today tasks", async () => {
    const s = await setup();
    const other = await setup();
    await createTask(s.owner, { title: "Overdue one", dueOn: "2026-03-01" });
    await createTask(s.owner, { title: "Overdue two", dueOn: "2026-03-09" });
    await createTask(s.owner, { title: "Due today", dueOn: "2026-03-10" });
    await createTask(s.owner, { title: "Due later", dueOn: "2026-03-30" });
    const finished = await createTask(s.owner, { title: "Late but done", dueOn: "2026-03-01" });
    await updateTask(s.owner, finished.id, { status: "DONE" }, now);
    await createTask(other.owner, { title: "Nothing due here", dueOn: "2026-04-30" });

    const first = await runTaskReminders({ db: prisma, alertDb: db, now });
    expect(first.alerts).toBeGreaterThanOrEqual(1);
    const alerts = await prisma.alert.findMany({
      where: { agencyId: s.agency.id, type: "TASK_DUE" },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "WARNING", title: "2 tasks overdue" });
    expect(alerts[0]?.body).toBe("2 tasks are overdue and 1 task is due today.");
    expect(await prisma.alert.count({ where: { agencyId: other.agency.id } })).toBe(0);

    await runTaskReminders({ db: prisma, alertDb: db, now });
    expect(await prisma.alert.count({ where: { agencyId: s.agency.id, type: "TASK_DUE" } })).toBe(
      1,
    );
    await runTaskReminders({ db: prisma, alertDb: db, now: new Date("2026-03-11T10:00:00Z") });
    expect(await prisma.alert.count({ where: { agencyId: s.agency.id, type: "TASK_DUE" } })).toBe(
      2,
    );
  });
});

describe("tenant isolation: tasks", () => {
  it("another agency cannot read, change, comment on or delete a task, nor see it in lists", async () => {
    const a = await setup();
    const b = await setup();
    const { id } = await createTask(b.owner, { title: "Secret plan" });
    await expect(getTask(a.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateTask(a.owner, id, { title: "Hacked title" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(addTaskComment(a.owner, id, { body: "Hello" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteTask(a.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listTasks(a.owner)).total).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).title).toBe("Secret plan");
  });
});
