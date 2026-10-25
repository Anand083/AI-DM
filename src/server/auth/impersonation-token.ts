import { createHmac, timingSafeEqual } from "node:crypto";

export const IMPERSONATION_COOKIE = "support_session";
export const IMPERSONATION_MINUTES = 30;

const sign = (id: string, secret: string) =>
  createHmac("sha256", secret).update(`impersonation:${id}`).digest("base64url");

/** The cookie value for an impersonation: the id and a signature, so it cannot be made up. */
export function makeImpersonationToken(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`;
}

/** Returns the impersonation id if the signature is right, otherwise null. */
export function readImpersonationToken(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(id, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}
