import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageProvider } from "@/server/providers/storage/types";
import { uploadLatestBackup } from "./backup-upload";

function fakeDb() {
  const rows = new Map<string, unknown>();
  const db = {
    platformSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null,
      upsert: async ({ create }: { create: { key: string; value: unknown } }) => {
        rows.set(create.key, create.value);
      },
    },
  };
  return db as unknown as PrismaClient;
}

function fakeStorage() {
  const put: { key: string; size: number }[] = [];
  const storage: StorageProvider = {
    name: "s3",
    put: async (key, bytes) => {
      put.push({ key, size: bytes.length });
    },
    get: async () => null,
    delete: async () => {},
  };
  return { storage, put };
}

describe("uploadLatestBackup", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bk-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does nothing when no folder is set", async () => {
    const { storage, put } = fakeStorage();
    const result = await uploadLatestBackup({ db: fakeDb(), storage, dir: undefined });
    expect(result.status).toBe("disabled");
    expect(put).toHaveLength(0);
  });

  it("reports when there is no dump yet", async () => {
    const { storage } = fakeStorage();
    expect((await uploadLatestBackup({ db: fakeDb(), storage, dir })).status).toBe("no-backup");
    expect(
      (await uploadLatestBackup({ db: fakeDb(), storage, dir: path.join(dir, "missing") })).status,
    ).toBe("no-backup");
  });

  it("uploads the newest dump once, ignoring other files", async () => {
    await writeFile(path.join(dir, "db-20260101T020000Z.dump"), "old");
    await writeFile(path.join(dir, "db-20260102T020000Z.dump"), "newest!");
    await writeFile(path.join(dir, "db-20260103T020000Z.dump.partial"), "half written");
    await writeFile(path.join(dir, "notes.txt"), "x");
    const db = fakeDb();
    const { storage, put } = fakeStorage();

    const first = await uploadLatestBackup({ db, storage, dir });
    expect(first).toEqual({ status: "uploaded", file: "db-20260102T020000Z.dump", bytes: 7 });
    expect(put).toEqual([{ key: "backups/db-20260102T020000Z.dump", size: 7 }]);

    const second = await uploadLatestBackup({ db, storage, dir });
    expect(second.status).toBe("already-uploaded");
    expect(put).toHaveLength(1);

    await writeFile(path.join(dir, "db-20260104T020000Z.dump"), "next");
    expect((await uploadLatestBackup({ db, storage, dir })).status).toBe("uploaded");
    expect(put).toHaveLength(2);
  });
});
