import { describe, expect, it } from "vitest";
import { totp } from "./totp";

// RFC 6238 test vectors use the ASCII key "12345678901234567890", which is this base32 text.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp helper", () => {
  it("matches the RFC 6238 SHA-1 test vectors (last 6 digits)", () => {
    expect(totp(SECRET, new Date(59 * 1000))).toBe("287082");
    expect(totp(SECRET, new Date(1111111109 * 1000))).toBe("081804");
    expect(totp(SECRET, new Date(1234567890 * 1000))).toBe("005924");
    expect(totp(SECRET, new Date(2000000000 * 1000))).toBe("279037");
  });
  it("stays the same inside one 30 second step", () => {
    expect(totp(SECRET, new Date(30_000))).toBe(totp(SECRET, new Date(59_999)));
    expect(totp(SECRET, new Date(30_000))).not.toBe(totp(SECRET, new Date(60_000)));
  });
  it("refuses a bad secret", () => {
    expect(() => totp("not-base32!")).toThrow();
  });
});
