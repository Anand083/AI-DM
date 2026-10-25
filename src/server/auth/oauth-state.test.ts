import { describe, expect, it } from "vitest";
import { makeOAuthState, newNonce, readOAuthState, sameText } from "./oauth-state";

const secret = "test-secret-test-secret-test-secret-1234";
const now = new Date("2026-03-10T10:00:00Z");
const input = { userId: "u1", agencyId: "a1", slug: "acme", projectId: "p1", nonce: "n1" };

describe("oauth state", () => {
  it("gives back the details it was made with", () => {
    const state = makeOAuthState(input, secret, now);
    expect(readOAuthState(state, secret, now)).toMatchObject(input);
  });

  it("expires after 10 minutes", () => {
    const state = makeOAuthState(input, secret, now);
    expect(readOAuthState(state, secret, new Date(now.getTime() + 9 * 60_000))).not.toBeNull();
    expect(readOAuthState(state, secret, new Date(now.getTime() + 11 * 60_000))).toBeNull();
  });

  it("rejects a wrong secret, a changed body and rubbish", () => {
    const state = makeOAuthState(input, secret, now);
    expect(readOAuthState(state, "another-secret-another-secret-1234567", now)).toBeNull();
    const [body, sig] = state.split(".");
    const other = Buffer.from(
      JSON.stringify({ ...input, projectId: "p2", exp: 9_999_999_999 }),
    ).toString("base64url");
    expect(readOAuthState(`${other}.${sig}`, secret, now)).toBeNull();
    expect(readOAuthState(`${body}.`, secret, now)).toBeNull();
    for (const bad of [null, undefined, "", "abc", "a.b"]) {
      expect(readOAuthState(bad, secret, now)).toBeNull();
    }
  });

  it("makes different nonces and compares texts safely", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(sameText("abc", "abc")).toBe(true);
    expect(sameText("abc", "abd")).toBe(false);
    expect(sameText("abc", "abcd")).toBe(false);
  });
});
