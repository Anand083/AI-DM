import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("quotes cells with commas, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("plain")).toBe("plain");
  });
  it("stops spreadsheet formulas in text", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('=HYPERLINK("http://evil.test","x")')).toBe(
      `"'=HYPERLINK(""http://evil.test"",""x"")"`,
    );
  });
  it("leaves numbers alone, including negative ones", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(Number.NaN)).toBe("");
  });
  it("writes empty for null and undefined, and true or false for booleans", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
  });
});

describe("toCsv", () => {
  it("writes a header and rows with Windows line endings", () => {
    expect(
      toCsv(
        ["Keyword", "Position"],
        [
          ["seo", 3],
          ["a,b", null],
        ],
      ),
    ).toBe('Keyword,Position\r\nseo,3\r\n"a,b",\r\n');
  });
});
