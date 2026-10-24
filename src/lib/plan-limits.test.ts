import { describe, expect, it } from "vitest";
import { wouldExceed } from "./plan-limits";

describe("wouldExceed", () => {
  it("allows adding up to the limit", () => {
    expect(wouldExceed(5, 4)).toBe(false);
    expect(wouldExceed(5, 5)).toBe(true);
    expect(wouldExceed(5, 3, 2)).toBe(false);
    expect(wouldExceed(5, 4, 2)).toBe(true);
  });
  it("treats -1 as unlimited", () => {
    expect(wouldExceed(-1, 1_000_000)).toBe(false);
  });
  it("blocks everything at a limit of 0", () => {
    expect(wouldExceed(0, 0)).toBe(true);
  });
});
