import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

/** The 32 byte key for AES-256 comes from the secret text by hashing, so any long text works. */
const keyFrom = (secret: string) => createHash("sha256").update(`secret-box:${secret}`).digest();

/**
 * Encrypts a short secret such as an OAuth token (AES-256-GCM, random IV for every call).
 * The result is one text value: `v1.<iv>.<tag>.<data>`. Changing any part makes `open` fail.
 */
export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

/** Decrypts a value made by `seal`. Throws when the secret is wrong or the value was changed. */
export function open(sealed: string, secret: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("Not an encrypted value.");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
