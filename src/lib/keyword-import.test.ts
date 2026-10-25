import { describe, expect, it } from "vitest";
import { parseCsv, parseKeywordCsv } from "./keyword-import";

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, commas and line endings", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n\n4,5,6')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(parseCsv("﻿x,y")).toEqual([["x", "y"]]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("parseKeywordCsv", () => {
  it("reads named columns in any order", () => {
    const { rows, problems } = parseKeywordCsv(
      'URL,Keyword,Tags\nhttps://a.com/x,Running Shoes,"brand; local"\n,Trail shoes,\n',
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { phrase: "running shoes", tags: ["brand", "local"], targetUrl: "https://a.com/x" },
      { phrase: "trail shoes", tags: [], targetUrl: null },
    ]);
  });
  it("reads a plain list and unnamed columns", () => {
    expect(parseKeywordCsv("seo tips\nlink building").rows.map((r) => r.phrase)).toEqual([
      "seo tips",
      "link building",
    ]);
    expect(parseKeywordCsv("seo tips,blog,https://a.com/s").rows[0]).toEqual({
      phrase: "seo tips",
      tags: ["blog"],
      targetUrl: "https://a.com/s",
    });
  });
  it("lists bad lines with their line number and keeps the good ones", () => {
    const long = "x".repeat(101);
    const { rows, problems } = parseKeywordCsv(
      `keyword,tags,url\nok one,,\n,,\nok two,,notaurl\n${long},,\nok one,,\n`,
    );
    expect(rows.map((r) => r.phrase)).toEqual(["ok one"]);
    expect(problems).toEqual([
      { line: 4, message: '"notaurl" is not a full web address.' },
      { line: 5, message: "Keyword is longer than 100 characters." },
      { line: 6, message: '"ok one" is listed twice. The first one is used.' },
    ]);
  });
  it("removes the apostrophe an export adds in front of formula-like text", () => {
    expect(parseKeywordCsv("keyword\n'=sum(a)").rows[0]!.phrase).toBe("=sum(a)");
  });
});
