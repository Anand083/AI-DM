import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type StorageProvider, type StoredFile } from "./types";

const EXTENSION_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

/**
 * Stores files in a folder on disk (`STORAGE_LOCAL_DIR`). The content type is written next to
 * the file as `<key>.type`, so it survives restarts even for unusual extensions.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(directory: string) {
    this.root = path.resolve(directory);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    // Belt and braces: even a key that passed the pattern must stay inside the folder.
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Unsafe storage key: ${key}`);
    return full;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(`${file}.type`, contentType, "utf8");
  }

  async get(key: string): Promise<StoredFile | null> {
    const file = this.resolve(key);
    try {
      const bytes = await readFile(file);
      let contentType =
        EXTENSION_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      try {
        contentType = (await readFile(`${file}.type`, "utf8")).trim() || contentType;
      } catch {
        // No .type file: use the guess from the extension.
      }
      return { bytes, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.type`, { force: true });
  }
}
