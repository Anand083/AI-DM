import { describe, expect, it } from "vitest";
import { MAX_PASTE_LINES, normalizePhrase, parseKeywordPaste, parseTags } from "./keyword-input";

describe("normalizePhrase", () => {
  it("lowercases, trims, collapses spaces and removes wrapping quotes", () => {
    expect(normalizePhrase('  "Best   SEO Tools" ')).toBe("best seo tools");
    expect(normalizePhrase("Dentist\tNear Me")).toBe("dentist near me");
    expect(normalizePhrase("   ")).toBe("");
  });
});

describe("parseKeywordPaste", () => {
  it("reads one keyword per line, skipping empty lines", () => {
    const r = parseKeywordPaste("seo tools\n\n  Dentist near me \r\nbuy shoes\n");
    expect(r.phrases).toEqual(["seo tools", "dentist near me", "buy shoes"]);
  });
  it("removes duplicates (ignoring case and spaces) and reports them", () => {
    const r = parseKeywordPaste("SEO tools\nseo  tools\nother\nOTHER\nthird");
    expect(r.phrases).toEqual(["seo tools", "other", "third"]);
    expect(r.duplicates).toEqual(["seo tools", "other"]);
  });
  it("reports lines that are too long", () => {
    const r = parseKeywordPaste(`ok\n${"x".repeat(101)}`);
    expect(r.phrases).toEqual(["ok"]);
    expect(r.tooLong).toHaveLength(1);
  });
  it("stops reading after the maximum number of lines", () => {
    const text = Array.from({ length: MAX_PASTE_LINES + 10 }, (_, i) => `kw ${i}`).join("\n");
    const r = parseKeywordPaste(text);
    expect(r.phrases).toHaveLength(MAX_PASTE_LINES);
    expect(r.truncated).toBe(true);
  });
  it("handles empty text", () => {
    expect(parseKeywordPaste("")).toMatchObject({
      phrases: [],
      duplicates: [],
      tooLong: [],
      truncated: false,
    });
  });
});

describe("parseTags", () => {
  it("splits on commas and new lines, lowercases and removes duplicates", () => {
    expect(parseTags("Brand, local seo,BRAND\nservices")).toEqual([
      "brand",
      "local seo",
      "services",
    ]);
  });
  it("drops tags that are empty, too long or have odd characters", () => {
    expect(parseTags(`ok, ,${"a".repeat(31)}, bad<tag>, <script>`)).toEqual(["ok"]);
  });
  it("keeps at most 10 tags", () => {
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(","))).toHaveLength(10);
  });
});
