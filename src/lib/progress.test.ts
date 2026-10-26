import { describe, expect, it } from "vitest";
import { buildProgress, progressSentence } from "./progress";

const row = (a: number | null, b: number | null, first = "2026-01-01", cur = "2026-02-01") => ({
  firstDate: first,
  firstPosition: a,
  currentDate: cur,
  currentPosition: b,
});

describe("buildProgress", () => {
  it("counts up, down and same, with not ranking as 101", () => {
    const p = buildProgress([row(30, 5), row(4, 12), row(null, 40), row(10, 10), row(8, null)]);
    expect(p.compared).toBe(5);
    expect(p.up).toBe(2);
    expect(p.down).toBe(2);
    expect(p.same).toBe(1);
    expect(p.pageOneStart).toBe(3);
    expect(p.pageOneNow).toBe(2);
  });
  it("gives a better verdict when visibility grows", () => {
    expect(buildProgress([row(50, 3), row(40, 8)]).verdict).toBe("better");
    expect(buildProgress([row(3, 50), row(8, 40)]).verdict).toBe("worse");
    expect(buildProgress([row(3, 3)]).verdict).toBe("same");
  });
  it("waits for a second day of checks", () => {
    const p = buildProgress([row(5, 5, "2026-02-01", "2026-02-01"), row(9, 4)]);
    expect(p.compared).toBe(1);
    expect(p.waiting).toBe(1);
    expect(p.since).toBe("2026-01-01");
    expect(buildProgress([row(5, 5, "2026-02-01", "2026-02-01")]).verdict).toBe("none");
  });
  it("handles no keywords", () => {
    const p = buildProgress([]);
    expect(p.since).toBeNull();
    expect(p.verdict).toBe("none");
    expect(progressSentence(p)).toBe("No keywords have been checked yet.");
  });
  it("writes a sentence", () => {
    const text = progressSentence(buildProgress([row(50, 3), row(40, 8), row(5, 20)]));
    expect(text).toContain("better than at the start");
    expect(text).toContain("2 up, 1 down");
  });
});
