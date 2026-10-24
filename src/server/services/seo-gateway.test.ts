import { describe, expect, it } from "vitest";
import { requestHash, stableStringify } from "./seo-gateway";

describe("stableStringify and requestHash", () => {
  it("ignores key order and undefined values", () => {
    expect(stableStringify({ a: 1, b: { d: 2, c: 3 } })).toBe(
      stableStringify({ b: { c: 3, d: 2 }, a: 1, x: undefined }),
    );
  });
  it("keeps array order", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
  it("hashes differently by provider, operation, input and day", () => {
    const base = requestHash("mock", "rankings", { a: 1 }, "2026-03-10");
    expect(base).toBe(requestHash("mock", "rankings", { a: 1 }, "2026-03-10"));
    expect(base).not.toBe(requestHash("dataforseo", "rankings", { a: 1 }, "2026-03-10"));
    expect(base).not.toBe(requestHash("mock", "keyword_ideas", { a: 1 }, "2026-03-10"));
    expect(base).not.toBe(requestHash("mock", "rankings", { a: 2 }, "2026-03-10"));
    expect(base).not.toBe(requestHash("mock", "rankings", { a: 1 }, "2026-03-11"));
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});
