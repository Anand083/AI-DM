import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPortalContext } from "@/server/auth/tenant-context";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from "@/server/services/errors";
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  setMilestoneDone,
} from "@/server/services/milestones";
import {
  answerApproval,
  commentOnReport,
  commentOnTask,
  getPortalProgress,
  getPortalTask,
  listPortalReportComments,
  listPortalTasks,
} from "@/server/services/portal-tasks";
import { addReportComment, listReportComments } from "@/server/services/report-comments";
import {
  applyTemplate,
  createTemplate,
  deleteTemplate,
  listTemplates,
} from "@/server/services/task-templates";
import {
  addTaskComment,
  createTask,
  getTask,
  requestApproval,
  updateTask,
} from "@/server/services/tasks";
import { createAgencyWithMembers, createUser, seedPlans } from "../factories";
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
  const mk = async (name: string) => {
    const client = await prisma.client.create({ data: { agencyId: agency.id, name } });
    const project = await prisma.project.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: `${name} site`,
        domain: `${name.toLowerCase()}.test`,
        locationCode: 2840,
        languageCode: "en",
      },
    });
    return { client, project };
  };
  const a = await mk("Alpha");
  const b = await mk("Beta");
  const user = await createUser(prisma);
  await prisma.clientUser.create({
    data: { agencyId: agency.id, clientId: a.client.id, userId: user.id },
  });
  const portal = (await loadPortalContext(user.id, agency.slug))!;
  return {
    agency,
    owner: members[0]!.ctx,
    admin: members[1]!.ctx,
    member: members[2]!.ctx,
    a,
    b,
    portal,
    user,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

describe("milestones", () => {
  it("creates, tracks progress from linked tasks, completes and deletes", async () => {
    const s = await setup();
    const { id } = await createMilestone(s.member, s.a.project.id, {
      title: "Fix the basics",
      dueOn: "2026-04-30",
    });
    const t1 = await createTask(s.owner, {
      title: "First linked task",
      projectId: s.a.project.id,
      milestoneId: id,
    });
    await createTask(s.owner, {
      title: "Second linked task",
      projectId: s.a.project.id,
      milestoneId: id,
    });
    await updateTask(s.owner, t1.id, { status: "DONE" });

    let list = await listMilestones(s.owner, s.a.project.id);
    expect(list).toEqual([
      expect.objectContaining({
        id,
        title: "Fix the basics",
        dueOn: "2026-04-30",
        total: 2,
        done: 1,
        percent: 50,
        completedAt: null,
      }),
    ]);
    await setMilestoneDone(s.admin, s.a.project.id, id, true, new Date("2026-04-01T10:00:00Z"));
    list = await listMilestones(s.owner, s.a.project.id);
    expect(list[0]?.completedAt).toEqual(new Date("2026-04-01T10:00:00Z"));
    await setMilestoneDone(s.admin, s.a.project.id, id, false);
    expect((await listMilestones(s.owner, s.a.project.id))[0]?.completedAt).toBeNull();

    await expect(deleteMilestone(s.member, s.a.project.id, id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await deleteMilestone(s.admin, s.a.project.id, id);
    expect(await listMilestones(s.owner, s.a.project.id)).toEqual([]);
    expect((await getTask(s.owner, t1.id)).milestoneId).toBeNull();
    await expect(deleteMilestone(s.admin, s.a.project.id, id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("checks the title and the date, and a task can only use a milestone of its own project", async () => {
    const s = await setup();
    await expect(createMilestone(s.owner, s.a.project.id, { title: "ab" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createMilestone(s.owner, s.a.project.id, { title: "Good one", dueOn: "2026-02-31" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const { id } = await createMilestone(s.owner, s.b.project.id, { title: "Beta goal" });
    await expect(
      createTask(s.owner, {
        title: "Wrong project task",
        projectId: s.a.project.id,
        milestoneId: id,
      }),
    ).rejects.toMatchObject({
      fieldErrors: { milestoneId: "Choose a milestone of this project." },
    });
    await expect(
      createTask(s.owner, { title: "No project task", milestoneId: id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("is private to the agency", async () => {
    const x = await setup();
    const y = await setup();
    const { id } = await createMilestone(y.owner, y.a.project.id, { title: "Secret goal" });
    await expect(listMilestones(x.owner, y.a.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createMilestone(x.owner, y.a.project.id, { title: "Planted goal" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setMilestoneDone(x.owner, y.a.project.id, id, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteMilestone(x.owner, y.a.project.id, id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setMilestoneDone(x.owner, x.a.project.id, id, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma.milestone.count({ where: { id } })).toBe(1);
  });
});

async function visibleTask(s: S, extra: object = {}) {
  return createTask(s.owner, {
    title: "Rewrite the service pages",
    projectId: s.a.project.id,
    clientVisible: true,
    assigneeId: s.member.userId,
    estimateMinutes: 120,
    ...extra,
  });
}

describe("what clients see of tasks", () => {
  it("only visible tasks of their own websites, without owner, estimate or private comments", async () => {
    const s = await setup();
    const shown = await visibleTask(s);
    await createTask(s.owner, { title: "Private team task", projectId: s.a.project.id });
    await createTask(s.owner, {
      title: "Other client's task",
      projectId: s.b.project.id,
      clientVisible: true,
    });
    await addTaskComment(s.owner, shown.id, { body: "Internal: the client is slow to reply" });
    await addTaskComment(s.owner, shown.id, { body: "We start on Monday.", clientVisible: true });

    const list = await listPortalTasks(s.portal);
    expect(list.rows.map((r) => r.title)).toEqual(["Rewrite the service pages"]);
    expect(list.total).toBe(1);
    expect(JSON.stringify(list)).not.toMatch(/assignee|estimate|createdById/);

    const task = await getPortalTask(s.portal, shown.id);
    expect(task.comments.map((c) => [c.body, c.author])).toEqual([
      ["We start on Monday.", "Your agency"],
    ]);
    expect(JSON.stringify(task)).not.toMatch(/Internal|assignee|estimate/);
  });

  it("not found for hidden tasks, other clients' tasks and other agencies", async () => {
    const s = await setup();
    const other = await setup();
    const hidden = await createTask(s.owner, {
      title: "Hidden task here",
      projectId: s.a.project.id,
    });
    const betas = await createTask(s.owner, {
      title: "Beta task",
      projectId: s.b.project.id,
      clientVisible: true,
    });
    const foreign = await createTask(other.owner, {
      title: "Foreign task",
      projectId: other.a.project.id,
      clientVisible: true,
    });
    for (const id of [hidden.id, betas.id, foreign.id]) {
      await expect(getPortalTask(s.portal, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(commentOnTask(s.portal, id, { body: "Hello" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(answerApproval(s.portal, id, { decision: "APPROVE" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
  });

  it("team can only write to the client on tasks the client can see, and needs a project to share", async () => {
    const s = await setup();
    const task = await createTask(s.owner, { title: "Not shared yet", projectId: s.a.project.id });
    await expect(
      addTaskComment(s.owner, task.id, { body: "Hi", clientVisible: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTask(s.owner, { title: "No project task", clientVisible: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateTask(s.owner, task.id, { clientVisible: true });
    await addTaskComment(s.owner, task.id, { body: "Hi", clientVisible: true });
  });
});

describe("client comments", () => {
  it("are saved as the client's, shown to the team, and alert the agency", async () => {
    const s = await setup();
    const task = await visibleTask(s);
    await commentOnTask(s.portal, task.id, { body: "  Can we also cover the pricing page?  " });
    const forTeam = await getTask(s.owner, task.id);
    expect(forTeam.comments).toEqual([
      expect.objectContaining({
        body: "Can we also cover the pricing page?",
        fromClient: true,
        clientVisible: true,
      }),
    ]);
    const mine = await getPortalTask(s.portal, task.id);
    expect(mine.comments[0]).toMatchObject({ fromClient: true });
    const alert = await prisma.alert.findFirstOrThrow({
      where: { agencyId: s.agency.id, type: "CLIENT_RESPONSE" },
    });
    expect(alert).toMatchObject({
      title: "A client commented on a task",
      projectId: s.a.project.id,
    });
    await expect(commentOnTask(s.portal, task.id, { body: "  " })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("approvals", () => {
  it("the client approves, once", async () => {
    const s = await setup();
    const task = await createTask(s.owner, {
      title: "New homepage text",
      projectId: s.a.project.id,
    });
    await requestApproval(s.member, task.id);
    const asked = await getTask(s.owner, task.id);
    expect(asked).toMatchObject({ clientVisible: true, approvalStatus: "REQUESTED" });
    expect((await listPortalTasks(s.portal)).waitingForApproval).toBe(1);

    await answerApproval(
      s.portal,
      task.id,
      { decision: "APPROVE", note: "Looks good" },
      new Date("2026-03-10T10:00:00Z"),
    );
    const done = await getTask(s.owner, task.id);
    expect(done).toMatchObject({ approvalStatus: "APPROVED", approvalNote: "Looks good" });
    expect(done.approvalAt).toEqual(new Date("2026-03-10T10:00:00Z"));
    expect((await listPortalTasks(s.portal)).waitingForApproval).toBe(0);
    await expect(answerApproval(s.portal, task.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(
      await prisma.alert.count({
        where: { agencyId: s.agency.id, title: "A client approved a task" },
      }),
    ).toBe(1);
  });

  it("asking for changes needs a note, reopens the work, and can be requested again", async () => {
    const s = await setup();
    const task = await createTask(s.owner, {
      title: "Draft the landing page",
      projectId: s.a.project.id,
    });
    await updateTask(s.owner, task.id, { status: "DONE" });
    await requestApproval(s.owner, task.id);
    await expect(answerApproval(s.portal, task.id, { decision: "CHANGES" })).rejects.toMatchObject({
      fieldErrors: { note: "Tell the agency what to change." },
    });
    await answerApproval(s.portal, task.id, { decision: "CHANGES", note: "Use our new slogan." });
    const after = await getTask(s.owner, task.id);
    expect(after).toMatchObject({
      approvalStatus: "CHANGES_REQUESTED",
      approvalNote: "Use our new slogan.",
      status: "TODO",
    });
    await requestApproval(s.owner, task.id);
    expect(await getTask(s.owner, task.id)).toMatchObject({
      approvalStatus: "REQUESTED",
      approvalNote: null,
    });
  });

  it("hiding the task from the client ends the request, and a task without a project cannot ask", async () => {
    const s = await setup();
    const task = await createTask(s.owner, {
      title: "Approval then hidden",
      projectId: s.a.project.id,
    });
    await requestApproval(s.owner, task.id);
    await updateTask(s.owner, task.id, { clientVisible: false });
    expect(await getTask(s.owner, task.id)).toMatchObject({
      approvalStatus: "NONE",
      clientVisible: false,
    });
    const loose = await createTask(s.owner, { title: "Task without project" });
    await expect(requestApproval(s.owner, loose.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(requestApproval({ ...s.owner, role: "CLIENT" }, task.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("the client's progress view", () => {
  it("counts visible tasks and shows visible milestones", async () => {
    const s = await setup();
    const m = await createMilestone(s.owner, s.a.project.id, {
      title: "Launch the new site",
      dueOn: "2026-05-01",
    });
    await createMilestone(s.owner, s.a.project.id, {
      title: "Internal goal",
      clientVisible: false,
    });
    const t1 = await visibleTask(s, { milestoneId: m.id });
    await visibleTask(s, { title: "Another visible task", milestoneId: m.id });
    await visibleTask(s, { title: "Third visible task" });
    await createTask(s.owner, {
      title: "Hidden task",
      projectId: s.a.project.id,
      milestoneId: m.id,
    });
    await updateTask(s.owner, t1.id, { status: "DONE" });

    const progress = await getPortalProgress(s.portal, s.a.project.id);
    expect(progress).toMatchObject({ total: 3, done: 1, percent: 33 });
    expect(progress.milestones).toEqual([
      {
        id: m.id,
        title: "Launch the new site",
        dueOn: "2026-05-01",
        reached: false,
        total: 2,
        done: 1,
        percent: 50,
      },
    ]);
    await expect(getPortalProgress(s.portal, s.b.project.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("task templates", () => {
  it("applies a built-in template with due days from the start day", async () => {
    const s = await setup();
    const result = await applyTemplate(s.member, {
      templateKey: "onboarding",
      projectId: s.a.project.id,
      startOn: "2026-03-30",
      assigneeId: s.admin.userId,
    });
    expect(result.created).toBe(5);
    const tasks = await prisma.task.findMany({
      where: { projectId: s.a.project.id },
      orderBy: { dueOn: "asc" },
    });
    expect(tasks).toHaveLength(5);
    expect(tasks[0]?.dueOn).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(tasks.every((t) => t.assigneeId === s.admin.userId)).toBe(true);
  });

  it("saves, lists, applies and deletes the agency's own template", async () => {
    const s = await setup();
    const { id } = await createTemplate(s.member, {
      name: "Quarterly review",
      lines: "Pull the numbers | 2 | high\nWrite the plan | 5",
    });
    const own = (await listTemplates(s.owner)).find((t) => t.custom);
    expect(own).toMatchObject({ key: `custom:${id}`, name: "Quarterly review" });
    expect(own?.items.map((i) => [i.title, i.days, i.priority])).toEqual([
      ["Pull the numbers", 2, "HIGH"],
      ["Write the plan", 5, "MEDIUM"],
    ]);
    await applyTemplate(s.owner, {
      templateKey: `custom:${id}`,
      projectId: s.a.project.id,
      startOn: "2026-01-01",
    });
    expect(await prisma.task.count({ where: { projectId: s.a.project.id } })).toBe(2);
    await expect(
      createTemplate(s.owner, { name: "Quarterly review", lines: "A task here" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteTemplate(s.member, id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteTemplate(s.admin, id);
    expect((await listTemplates(s.owner)).some((t) => t.custom)).toBe(false);
  });

  it("explains bad lines, unknown templates, other agencies' templates and bad assignees", async () => {
    const x = await setup();
    const y = await setup();
    await expect(
      createTemplate(x.owner, { name: "Bad one", lines: "ab\nFine task | 999" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      applyTemplate(x.owner, {
        templateKey: "nope",
        projectId: x.a.project.id,
        startOn: "2026-01-01",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const { id } = await createTemplate(y.owner, { name: "Their template", lines: "Do the thing" });
    await expect(
      applyTemplate(x.owner, {
        templateKey: `custom:${id}`,
        projectId: x.a.project.id,
        startOn: "2026-01-01",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTemplate(x.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      applyTemplate(x.owner, {
        templateKey: "monthly",
        projectId: x.a.project.id,
        startOn: "2026-01-01",
        assigneeId: y.owner.userId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      applyTemplate(x.owner, {
        templateKey: "monthly",
        projectId: y.a.project.id,
        startOn: "2026-01-01",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.task.count({ where: { agencyId: x.agency.id } })).toBe(0);
  });
});

describe("report comments", () => {
  async function report(s: S, projectId: string) {
    return prisma.report.create({
      data: {
        agencyId: s.agency.id,
        projectId,
        title: "March report",
        status: "READY",
        periodStart: new Date("2026-03-01"),
        periodEnd: new Date("2026-03-31"),
        sections: ["summary"],
        data: { version: 1 },
      },
    });
  }

  it("team and client talk on a report in order, and the agency is alerted", async () => {
    const s = await setup();
    const r = await report(s, s.a.project.id);
    await addReportComment(s.member, r.id, { body: "Here is the March report." });
    await commentOnReport(s.portal, r.id, { body: "Thanks! Why did rankings drop?" });
    const team = await listReportComments(s.owner, r.id);
    expect(team.map((c) => [c.body, c.fromClient])).toEqual([
      ["Here is the March report.", false],
      ["Thanks! Why did rankings drop?", true],
    ]);
    const client = await listPortalReportComments(s.portal, r.id);
    expect(client.map((c) => c.author)).toEqual([expect.any(String), "You"]);
    expect(
      await prisma.alert.count({
        where: { agencyId: s.agency.id, title: "A client commented on a report" },
      }),
    ).toBe(1);
    await expect(commentOnReport(s.portal, r.id, { body: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("clients cannot reach other clients' or unfinished reports, and others cannot read ours", async () => {
    const s = await setup();
    const other = await setup();
    const betas = await report(s, s.b.project.id);
    const draft = await prisma.report.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.a.project.id,
        title: "Draft",
        status: "GENERATING",
        periodStart: new Date("2026-03-01"),
        periodEnd: new Date("2026-03-31"),
        sections: ["summary"],
      },
    });
    for (const id of [betas.id, draft.id]) {
      await expect(commentOnReport(s.portal, id, { body: "Hello" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(listPortalReportComments(s.portal, id)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(listReportComments(other.owner, betas.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addReportComment(other.owner, betas.id, { body: "Hello" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
