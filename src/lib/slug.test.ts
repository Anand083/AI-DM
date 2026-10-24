import { describe, expect, it } from "vitest";
import { slugify, slugProblem } from "./slug";

describe("slugify", () => {
  it("makes a clean slug", () => {
    expect(slugify("Acme Digital!")).toBe("acme-digital");
    expect(slugify("  Café   Müller & Sons ")).toBe("cafe-muller-sons");
    expect(slugify("---")).toBe("");
  });
  it("limits the length without a trailing hyphen", () => {
    const slug = slugify("a".repeat(39) + " bbbb");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugProblem", () => {
  it("accepts good slugs", () => {
    expect(slugProblem("agency-one")).toBeNull();
    expect(slugProblem("a1b")).toBeNull();
  });
  it("rejects bad slugs", () => {
    for (const bad of [
      "ab",
      "Agency",
      "-abc",
      "abc-",
      "a b c",
      "a--b",
      "x".repeat(41),
      "under_score",
    ]) {
      expect(slugProblem(bad), bad).not.toBeNull();
    }
  });
  it("rejects reserved words", () => {
    for (const word of ["app", "admin", "portal", "api"])
      expect(slugProblem(word)).toMatch(/reserved|least/);
  });
});
