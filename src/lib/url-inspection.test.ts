import { describe, expect, it } from "vitest";
import { cleanInspectionUrl, describeInspection } from "./url-inspection";

const row = (o: Partial<Parameters<typeof describeInspection>[0]> = {}) => ({
  verdict: "PASS",
  coverageState: "Submitted and indexed",
  googleCanonical: "https://a.com/x",
  userCanonical: "https://a.com/x",
  mobileVerdict: "PASS",
  richVerdict: null,
  richTypes: [],
  robotsTxtState: "ALLOWED",
  lastCrawlTime: "2026-03-01T10:00:00Z",
  ...o,
});

describe("describeInspection", () => {
  it("says a good page is on Google and shows the last visit", () => {
    expect(describeInspection(row())).toEqual({
      status: "indexed",
      headline: "On Google",
      notes: ["Google says: Submitted and indexed.", "Last visited by Google on 2026-03-01."],
    });
  });
  it("flags the things worth acting on", () => {
    const v = describeInspection(
      row({
        verdict: "FAIL",
        coverageState: "Crawled - currently not indexed",
        googleCanonical: "https://a.com/",
        robotsTxtState: "DISALLOWED",
        mobileVerdict: "FAIL",
        richVerdict: "FAIL",
        lastCrawlTime: null,
      }),
    );
    expect(v.status).toBe("not-indexed");
    expect(v.headline).toBe("Not on Google");
    expect(v.notes).toEqual([
      "Google says: Crawled - currently not indexed.",
      "Google picked a different main address: https://a.com/.",
      "robots.txt blocks this page.",
      "The page is hard to use on a phone.",
      "The structured data has errors.",
    ]);
  });
  it("handles excluded, unknown and rich results", () => {
    expect(describeInspection(row({ verdict: "NEUTRAL" })).headline).toBe(
      "Left out of Google on purpose",
    );
    expect(describeInspection(row({ verdict: "VERDICT_UNSPECIFIED" })).status).toBe("unknown");
    expect(describeInspection(row({ richVerdict: "PASS", richTypes: ["FAQ"] })).notes).toContain(
      "Rich results found: FAQ.",
    );
  });
});

describe("cleanInspectionUrl", () => {
  it("accepts pages of the website and its subdomains and drops the #part", () => {
    expect(cleanInspectionUrl(" https://www.acme.com/a?x=1#top ", "acme.com")).toBe(
      "https://www.acme.com/a?x=1",
    );
    expect(cleanInspectionUrl("https://blog.acme.com/", "www.acme.com")).toBe(
      "https://blog.acme.com/",
    );
  });
  it("refuses other sites, look-alikes, odd schemes and nonsense", () => {
    for (const bad of [
      "https://evil.com/",
      "https://acme.com.evil.com/",
      "https://notacme.com/",
      "ftp://acme.com/",
      "javascript:alert(1)",
      "acme.com/page",
      "",
    ]) {
      expect(cleanInspectionUrl(bad, "acme.com")).toBeNull();
    }
  });
});
