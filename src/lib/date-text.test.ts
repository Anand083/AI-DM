import { describe, expect, it } from "vitest";
import { dateText } from "./date-text";

describe("dateText", () => {
  it("accepts real days", () => {
    expect(dateText.safeParse("2026-03-31").success).toBe(true);
    expect(dateText.safeParse("2028-02-29").success).toBe(true);
  });
  it("refuses impossible or badly written days without throwing", () => {
    for (const v of ["2026-02-31", "2026-13-10", "2027-02-29", "2026-3-1", "tomorrow", ""]) {
      expect(dateText.safeParse(v).success).toBe(false);
    }
  });
});
