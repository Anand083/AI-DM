import { describe, expect, it } from "vitest";
import { secretMatches } from "./callback-auth";

describe("secretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("abc123", "abc123")).toBe(true);
    expect(secretMatches("abc124", "abc123")).toBe(false);
    expect(secretMatches("abc12", "abc123")).toBe(false);
    expect(secretMatches("", "abc123")).toBe(false);
    expect(secretMatches(null, "abc123")).toBe(false);
    expect(secretMatches(undefined, "abc123")).toBe(false);
  });
  it("never accepts anything when no secret is configured", () => {
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("x", "")).toBe(false);
  });
});
