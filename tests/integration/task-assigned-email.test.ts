import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobIds } from "@/server/jobs/config";
import { getQueue } from "@/server/jobs/queues";
import { createTask, updateTask } from "@/server/services/tasks";
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

const mailJob = (taskId: string, userId: string) =>
  getQueue("emails").getJob(jobIds.email(`task_assigned_${taskId}_${userId}`));

describe("task assignment emails", () => {
  it("email the new assignee once, and never the person who assigned it to themselves", async () => {
    const { members } = await createAgencyWithMembers(
      prisma,
      ["OWNER", "MEMBER"],
      undefined,
      "GROWTH",
    );
    const [owner, member] = [members[0]!, members[1]!];
    const task = await createTask(owner.ctx, {
      title: "Fix titles",
      assigneeId: member.ctx.userId,
    });
    const job = await mailJob(task.id, member.ctx.userId);
    expect(job?.data.to).toBe(member.user.email);
    expect(job?.data.subject).toBe("Task: Fix titles");
    expect(job?.data.text).toContain("Fix titles");
    expect(job?.data.text).not.toContain("undefined");

    const own = await createTask(owner.ctx, { title: "My own", assigneeId: owner.ctx.userId });
    expect(await mailJob(own.id, owner.ctx.userId)).toBeUndefined();
  });

  it("email when a task is handed over, but not when the assignee did not change", async () => {
    const { members } = await createAgencyWithMembers(
      prisma,
      ["OWNER", "MEMBER"],
      undefined,
      "GROWTH",
    );
    const [owner, member] = [members[0]!, members[1]!];
    const task = await createTask(owner.ctx, { title: "Hand over" });
    expect(await mailJob(task.id, member.ctx.userId)).toBeUndefined();
    await updateTask(owner.ctx, task.id, { assigneeId: member.ctx.userId });
    expect(await mailJob(task.id, member.ctx.userId)).toBeTruthy();
    await updateTask(owner.ctx, task.id, { title: "Hand over 2" });
  });

  it("respect the person's choice to turn it off", async () => {
    const { members } = await createAgencyWithMembers(
      prisma,
      ["OWNER", "MEMBER"],
      undefined,
      "GROWTH",
    );
    const [owner, member] = [members[0]!, members[1]!];
    await prisma.agencyMember.update({
      where: { id: member.member.id },
      data: { emailTaskAssigned: false },
    });
    const task = await createTask(owner.ctx, { title: "Quiet", assigneeId: member.ctx.userId });
    expect(await mailJob(task.id, member.ctx.userId)).toBeUndefined();
  });
});
