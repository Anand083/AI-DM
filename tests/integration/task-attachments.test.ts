import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStorage } from "@/server/providers/storage";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  addAttachment,
  deleteAttachment,
  listAttachments,
  readAttachment,
} from "@/server/services/task-attachments";
import { deleteTask } from "@/server/services/tasks";
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

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    undefined,
    "GROWTH",
  );
  const task = await prisma.task.create({ data: { agencyId: agency.id, title: "With files" } });
  return { agency, owner: members[0]!.ctx, member: members[1]!.ctx, task };
}

describe("task attachments", () => {
  it("store a file, list it, and give the same bytes back", async () => {
    const s = await setup();
    const saved = await addAttachment(s.owner, s.task.id, { name: "../brief.pdf", bytes: PDF });
    expect(saved.name).toBe("brief.pdf");
    const list = await listAttachments(s.member, s.task.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "brief.pdf",
      contentType: "application/pdf",
      bytes: PDF.length,
    });
    const got = await readAttachment(s.member, s.task.id, saved.id);
    expect(got.bytes.equals(PDF)).toBe(true);
    expect(got.contentType).toBe("application/pdf");
  });

  it("trust the bytes, not the name, and refuse risky or empty files", async () => {
    const s = await setup();
    const named = await addAttachment(s.owner, s.task.id, { name: "photo.pdf", bytes: png() });
    expect(
      (await listAttachments(s.owner, s.task.id)).find((a) => a.id === named.id)?.contentType,
    ).toBe("image/png");
    for (const [name, bytes] of [
      ["x.svg", Buffer.from("<svg onload=alert(1)></svg>")],
      ["x.html", Buffer.from("<html><script>1</script></html>")],
      ["x.exe", Buffer.from("MZ....")],
      ["empty.txt", Buffer.alloc(0)],
    ] as const)
      await expect(addAttachment(s.owner, s.task.id, { name, bytes })).rejects.toBeInstanceOf(
        ValidationError,
      );
    await expect(
      addAttachment(s.owner, s.task.id, {
        name: "big.pdf",
        bytes: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]),
      }),
    ).rejects.toThrow(/5\.0 MB or smaller/);
  });

  it("allow up to 10 files per task", async () => {
    const s = await setup();
    for (let i = 0; i < 10; i++)
      await addAttachment(s.owner, s.task.id, {
        name: `f${i}.txt`,
        bytes: Buffer.from(`file ${i}`),
      });
    await expect(
      addAttachment(s.owner, s.task.id, { name: "more.txt", bytes: Buffer.from("x") }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("stay inside the agency and need edit rights to change", async () => {
    const a = await setup();
    const b = await setup();
    const saved = await addAttachment(a.owner, a.task.id, {
      name: "a.txt",
      bytes: Buffer.from("secret"),
    });
    await expect(readAttachment(b.owner, a.task.id, saved.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listAttachments(b.owner, a.task.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addAttachment(b.owner, a.task.id, { name: "b.txt", bytes: Buffer.from("x") }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAttachment(b.owner, a.task.id, saved.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Same agency, wrong task id.
    const other = await prisma.task.create({ data: { agencyId: a.agency.id, title: "Other" } });
    await expect(readAttachment(a.owner, other.id, saved.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addAttachment({ ...a.owner, role: "CLIENT" }, a.task.id, {
        name: "c.txt",
        bytes: Buffer.from("x"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      readAttachment({ ...a.owner, role: "CLIENT" }, a.task.id, saved.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("remove the stored file when deleted, and when the task is deleted", async () => {
    const s = await setup();
    const one = await addAttachment(s.owner, s.task.id, {
      name: "one.txt",
      bytes: Buffer.from("1"),
    });
    const two = await addAttachment(s.owner, s.task.id, {
      name: "two.txt",
      bytes: Buffer.from("2"),
    });
    const rows = await prisma.taskAttachment.findMany({ where: { taskId: s.task.id } });
    const key = (id: string) => rows.find((r) => r.id === id)!.storageKey;
    expect(await getStorage().get(key(one.id))).not.toBeNull();
    await deleteAttachment(s.owner, s.task.id, one.id);
    expect(await getStorage().get(key(one.id))).toBeNull();
    expect(await prisma.taskAttachment.count({ where: { id: one.id } })).toBe(0);
    await deleteTask(s.owner, s.task.id);
    expect(await getStorage().get(key(two.id))).toBeNull();
    expect(await prisma.taskAttachment.count({ where: { taskId: s.task.id } })).toBe(0);
  });
});
