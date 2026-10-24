import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import { assertSafeKey } from "./types";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "storage-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("assertSafeKey", () => {
  it("accepts normal keys", () => {
    for (const key of ["branding/abc123/logo-x1.png", "reports/a/b/report.pdf", "a.txt"])
      expect(() => assertSafeKey(key)).not.toThrow();
  });
  it("rejects keys that could leave the folder or look odd", () => {
    for (const key of [
      "../etc/passwd",
      "a/../../b",
      "/absolute",
      "a//b",
      "a/",
      "",
      " space",
      "a\\b",
      "a\u0000b",
      "x".repeat(300),
      ".hidden",
    ]) {
      expect(() => assertSafeKey(key), JSON.stringify(key)).toThrow(/Unsafe storage key/);
    }
  });
});

describe("LocalStorageProvider", () => {
  it("stores, reads back with the content type, and deletes", async () => {
    const storage = new LocalStorageProvider(dir);
    await storage.put("branding/a1/logo.png", Buffer.from("png-bytes"), "image/png");
    expect(await storage.get("branding/a1/logo.png")).toEqual({
      bytes: Buffer.from("png-bytes"),
      contentType: "image/png",
    });
    await storage.delete("branding/a1/logo.png");
    expect(await storage.get("branding/a1/logo.png")).toBeNull();
    expect(await readdir(path.join(dir, "branding", "a1"))).toEqual([]);
  });
  it("returns null for a missing file and allows deleting it", async () => {
    const storage = new LocalStorageProvider(dir);
    expect(await storage.get("nothing/here.png")).toBeNull();
    await expect(storage.delete("nothing/here.png")).resolves.toBeUndefined();
  });
  it("overwrites an existing key", async () => {
    const storage = new LocalStorageProvider(dir);
    await storage.put("x/file.webp", Buffer.from("one"), "image/webp");
    await storage.put("x/file.webp", Buffer.from("two"), "image/webp");
    expect((await storage.get("x/file.webp"))!.bytes.toString()).toBe("two");
  });
  it("refuses unsafe keys for every operation", async () => {
    const storage = new LocalStorageProvider(dir);
    await expect(storage.put("../escape.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(
      /Unsafe/,
    );
    await expect(storage.get("../escape.txt")).rejects.toThrow(/Unsafe/);
    await expect(storage.delete("../escape.txt")).rejects.toThrow(/Unsafe/);
  });
});

describe("S3StorageProvider", () => {
  it("sends the right commands and handles a missing key", async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const client = {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        calls.push({ name: command.constructor.name, input: command.input });
        if (command.constructor.name === "GetObjectCommand") {
          if (command.input.Key === "missing/file.png")
            throw Object.assign(new Error("nope"), { name: "NoSuchKey" });
          return {
            Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
            ContentType: "image/png",
          };
        }
        return {};
      },
    };
    const s3 = new S3StorageProvider("my-bucket", "eu-west-1", client);
    await s3.put("branding/a/logo.png", Buffer.from("x"), "image/png");
    expect(await s3.get("branding/a/logo.png")).toEqual({
      bytes: Buffer.from([1, 2, 3]),
      contentType: "image/png",
    });
    expect(await s3.get("missing/file.png")).toBeNull();
    await s3.delete("branding/a/logo.png");
    expect(calls.map((c) => c.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
    ]);
    expect(calls[0]!.input).toMatchObject({
      Bucket: "my-bucket",
      Key: "branding/a/logo.png",
      ContentType: "image/png",
    });
    await expect(s3.put("../x", Buffer.from("x"), "image/png")).rejects.toThrow(/Unsafe/);
  });
});
