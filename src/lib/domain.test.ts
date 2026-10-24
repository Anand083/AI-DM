import { describe, expect, it } from "vitest";
import { normalizeDomain, normalizeWebsite } from "./domain";

describe("normalizeDomain", () => {
  it("removes protocol, www, path, query, port, and trailing dot", () => {
    expect(normalizeDomain("https://www.Example.com/")).toBe("example.com");
    expect(normalizeDomain("http://example.com/a/b?x=1#top")).toBe("example.com");
    expect(normalizeDomain("  EXAMPLE.com  ")).toBe("example.com");
    expect(normalizeDomain("www.example.co.uk")).toBe("example.co.uk");
    expect(normalizeDomain("example.com:8080/path")).toBe("example.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });

  it("keeps real subdomains", () => {
    expect(normalizeDomain("https://blog.example.com/post")).toBe("blog.example.com");
  });

  it("accepts international domain names in punycode", () => {
    expect(normalizeDomain("https://münchen.de")).toBe("xn--mnchen-3ya.de");
    expect(normalizeDomain("xn--mnchen-3ya.de")).toBe("xn--mnchen-3ya.de");
  });

  it("rejects things that are not domains", () => {
    for (const bad of [
      "",
      "   ",
      "localhost",
      "example",
      "192.168.1.1",
      "http://",
      "exa mple.com",
      "-bad.com",
      "bad-.com",
      "a..b.com",
      "example.c",
      "example.123",
      "[::1]",
      "ftp://",
      "http://:80",
    ]) {
      expect(normalizeDomain(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("normalizeWebsite", () => {
  it("returns an https URL", () => {
    expect(normalizeWebsite("www.example.com/page")).toBe("https://example.com");
    expect(normalizeWebsite("nope")).toBeNull();
  });
});
