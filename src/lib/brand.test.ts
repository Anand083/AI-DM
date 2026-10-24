import { describe, expect, it } from "vitest";
import { brandCssVars, initials } from "./brand";

describe("brandCssVars", () => {
  it("returns the colours and a readable text colour for each", () => {
    expect(brandCssVars({ primaryColor: "#18181B", accentColor: "#fde68a" })).toEqual({
      "--brand-primary": "#18181b",
      "--brand-primary-text": "#ffffff",
      "--brand-accent": "#fde68a",
      "--brand-accent-text": "#000000",
    });
  });
  it("falls back to the defaults for missing or broken colours", () => {
    expect(brandCssVars({})["--brand-primary"]).toBe("#18181b");
    expect(brandCssVars({ accentColor: "nope" })["--brand-accent"]).toBe("#2563eb");
  });
});

describe("initials", () => {
  it("uses the first and last word", () => {
    expect(initials("Bright Dental")).toBe("BD");
    expect(initials("Acme Digital Marketing Group")).toBe("AG");
    expect(initials("Solo")).toBe("SO");
    expect(initials("  ")).toBe("?");
  });
});
