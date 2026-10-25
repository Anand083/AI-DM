import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { StorageProvider } from "@/server/providers/storage/types";

export const BACKUP_KEY_PREFIX = "backups/";
const SETTING_KEY = "backup.lastUploaded";
const FILE_PATTERN = /^db-\d{8}T\d{6}Z\.dump$/;

export type BackupUploadResult =
  | { status: "disabled" }
  | { status: "no-backup" }
  | { status: "already-uploaded"; file: string }
  | { status: "uploaded"; file: string; bytes: number };

/**
 * Copies the newest nightly database dump to the storage bucket. The backup container writes the
 * dumps into a shared folder; this runs in the worker a little later. A file is uploaded once:
 * its name is remembered in `PlatformSetting`. The bucket's lifecycle rule (see docs/OPERATIONS.md)
 * deletes copies after 14 days.
 */
export async function uploadLatestBackup(deps: {
  db: PrismaClient;
  storage: StorageProvider;
  dir: string | undefined;
}): Promise<BackupUploadResult> {
  if (!deps.dir) return { status: "disabled" };
  let names: string[];
  try {
    names = await readdir(deps.dir);
  } catch {
    return { status: "no-backup" };
  }
  // The names hold a UTC time stamp, so the biggest name is the newest file.
  const file = names
    .filter((n) => FILE_PATTERN.test(n))
    .sort()
    .at(-1);
  if (!file) return { status: "no-backup" };

  const last = await deps.db.platformSetting.findUnique({ where: { key: SETTING_KEY } });
  if (last?.value === file) return { status: "already-uploaded", file };

  const bytes = await readFile(path.join(deps.dir, file));
  await deps.storage.put(`${BACKUP_KEY_PREFIX}${file}`, bytes, "application/octet-stream");
  await deps.db.platformSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: file },
    update: { value: file },
  });
  return { status: "uploaded", file, bytes: bytes.length };
}
