import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_MINUTES = 10;
/** Cookie that ties the way back from Google to the browser that left. */
export const GOOGLE_NONCE_COOKIE = "google_oauth_nonce";

export type OAuthStatePayload = {
  userId: string;
  agencyId: string;
  slug: string;
  projectId: string;
  /** Random value that is also kept in a cookie, so the callback must come from the same browser. */
  nonce: string;
  /** Expiry as a Unix time in seconds. */
  exp: number;
};

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(`oauth-state:${body}`).digest("base64url");

export const newNonce = () => randomBytes(18).toString("base64url");

/** The `state` value sent to Google: the details and a signature, so they cannot be changed. */
export function makeOAuthState(
  input: Omit<OAuthStatePayload, "exp">,
  secret: string,
  now: Date = new Date(),
): string {
  const payload: OAuthStatePayload = {
    ...input,
    exp: Math.floor(now.getTime() / 1000) + OAUTH_STATE_MINUTES * 60,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Returns the details if the signature is right and the state has not expired, otherwise null. */
export function readOAuthState(
  state: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): OAuthStatePayload | null {
  if (!state) return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const given = Buffer.from(state.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
    if (
      typeof p.userId !== "string" ||
      typeof p.agencyId !== "string" ||
      typeof p.slug !== "string" ||
      typeof p.projectId !== "string" ||
      typeof p.nonce !== "string" ||
      typeof p.exp !== "number"
    )
      return null;
    return p.exp * 1000 > now.getTime() ? p : null;
  } catch {
    return null;
  }
}

/** Compares two texts without leaking where they differ. */
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
