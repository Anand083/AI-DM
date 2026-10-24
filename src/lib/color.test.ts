import { describe, expect, it } from "vitest";
import {
  checkBrandColors,
  contrastRatio,
  hexToRgb,
  luminance,
  normalizeHex,
  readableTextOn,
} from "./color";

describe("normalizeHex", () => {
  it("accepts 3 and 6 digit colours with or without #, in any case", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("2563EB")).toBe("#2563eb");
    expect(normalizeHex("  #18181b ")).toBe("#18181b");
  });
  it("rejects anything else", () => {
    for (const bad of [
      "",
      "#",
      "#12",
      "#12345",
      "#1234567",
      "#ggg",
      "red",
      "rgb(0,0,0)",
      "#12 345",
      "javascript:1",
      "#fff; background:url(x)",
    ]) {
      expect(normalizeHex(bad), bad).toBeNull();
    }
  });
});

describe("contrast", () => {
  it("knows black and white", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
  it("does not depend on the order", () => {
    expect(contrastRatio("#2563eb", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#2563eb"), 8);
  });
  it("matches known values", () => {
    // WCAG: #767676 on white is the lightest grey that just passes 4.5.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(contrastRatio("#2563eb", "#ffffff")).toBeCloseTo(5.17, 1);
  });
  it("converts hex to rgb", () => {
    expect(hexToRgb("#2563eb")).toEqual([37, 99, 235]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
  });
  it("picks readable text", () => {
    expect(readableTextOn("#18181b")).toBe("#ffffff");
    expect(readableTextOn("#fde68a")).toBe("#000000");
    expect(readableTextOn("#2563eb")).toBe("#ffffff");
  });
});

describe("checkBrandColors", () => {
  it("is quiet for good colours", () => {
    expect(checkBrandColors({ primaryColor: "#18181b", accentColor: "#2563eb" })).toEqual([]);
  });
  it("warns about colours that are too light", () => {
    const warnings = checkBrandColors({ primaryColor: "#facc15", accentColor: "#93c5fd" });
    expect(warnings.map((w) => w.field)).toEqual(["primaryColor", "accentColor"]);
    expect(warnings[0]!.message).toMatch(/main color is hard to read with white text/);
    expect(warnings[0]!.message).toMatch(/contrast \d\.\d/);
  });
  it("ignores values that are not colours yet (the form shows its own error)", () => {
    expect(checkBrandColors({ primaryColor: "oops", accentColor: "#12" })).toEqual([]);
  });
});
