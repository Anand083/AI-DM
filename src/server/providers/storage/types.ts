export type StoredFile = { bytes: Buffer; contentType: string };

export interface StorageProvider {
  readonly name: "local" | "s3";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Returns null when there is no file with this key. */
  get(key: string): Promise<StoredFile | null>;
  /** Deleting a file that does not exist is fine. */
  delete(key: string): Promise<void>;
}

/** Keys look like "branding/<agencyId>/logo-<random>.png". Only these characters are allowed. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,200}$/;

export function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..") || key.includes("//") || key.endsWith("/")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
