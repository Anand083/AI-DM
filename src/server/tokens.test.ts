import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "./tokens";

describe("tokens", () => {
  it("generates long, different, URL-safe tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes the same way every time and never returns the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toHaveLength(64);
  });
});
