import { createHash, randomBytes } from "node:crypto";

/** A random, URL-safe secret. Give this to the user; store only `hashToken(token)`. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
