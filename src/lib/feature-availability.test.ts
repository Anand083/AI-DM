import { describe, expect, it } from "vitest";
import { unavailableMessage } from "./feature-availability";

describe("unavailableMessage", () => {
  it("explains what DataForSEO cannot do yet", () => {
    for (const f of ["ai", "reviews", "listings"] as const)
      expect(unavailableMessage("dataforseo", f)).toMatch(/not available/);
  });
  it("lets the mock source do everything", () => {
    for (const f of ["ai", "reviews", "listings"] as const)
      expect(unavailableMessage("mock", f)).toBeNull();
  });
});
