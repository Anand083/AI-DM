import "server-only";
import { getEnv } from "@/env";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

export type { StorageProvider, StoredFile } from "./types";

let provider: StorageProvider | undefined;

/** Picks the storage provider from `STORAGE_PROVIDER`. */
export function getStorage(): StorageProvider {
  if (provider) return provider;
  const env = getEnv();
  provider =
    env.STORAGE_PROVIDER === "s3"
      ? new S3StorageProvider(env.S3_BUCKET, env.AWS_REGION)
      : new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
  return provider;
}
