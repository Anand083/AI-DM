import { describe, expect, it } from "vitest";
import { makeImpersonationToken, readImpersonationToken } from "./impersonation-token";

const secret = "s".repeat(32);

describe("impersonation token", () => {
  it("round trips an id", () => {
    const token = makeImpersonationToken("abc123", secret);
    expect(readImpersonationToken(token, secret)).toBe("abc123");
  });
  it("rejects changed ids, wrong secrets and junk", () => {
    const token = makeImpersonationToken("abc123", secret);
    expect(readImpersonationToken(token.replace("abc123", "abc124"), secret)).toBeNull();
    expect(readImpersonationToken(token, "x".repeat(32))).toBeNull();
    expect(readImpersonationToken("nodot", secret)).toBeNull();
    expect(readImpersonationToken(".sig", secret)).toBeNull();
    expect(readImpersonationToken("", secret)).toBeNull();
    expect(readImpersonationToken(undefined, secret)).toBeNull();
    expect(readImpersonationToken(`abc123.${"A".repeat(10)}`, secret)).toBeNull();
  });
});
