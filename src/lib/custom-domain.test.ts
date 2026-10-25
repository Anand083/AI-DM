import { describe, expect, it } from "vitest";
import {
  classifyHost,
  dnsInstructions,
  hostOf,
  normalizeHost,
  portalPathFor,
} from "./custom-domain";

describe("normalizeHost", () => {
  it("cleans typed text and keeps www", () => {
    expect(normalizeHost("https://Portal.Example.com/path?x=1")).toBe("portal.example.com");
    expect(normalizeHost("www.example.com")).toBe("www.example.com");
    expect(normalizeHost("  reports.agency.co.uk. ")).toBe("reports.agency.co.uk");
    expect(normalizeHost("agency-one.lvh.me")).toBe("agency-one.lvh.me");
  });
  it("refuses bad input", () => {
    for (const bad of [
      "",
      "localhost",
      "example",
      "a b.com",
      "http://1.2.3.4",
      "example.com:8080",
      "http://u:p@example.com",
      "-a.example.com",
      "exa_mple.com",
      "example.c0m",
    ]) {
      expect(normalizeHost(bad), bad).toBeNull();
    }
  });
});

describe("classifyHost", () => {
  const platform = ["app.platform.test"];
  it("knows the platform and local hosts", () => {
    expect(classifyHost("app.platform.test", platform)).toEqual({ kind: "platform" });
    expect(classifyHost("APP.platform.test:443", platform)).toEqual({ kind: "platform" });
    expect(classifyHost("localhost:3000", platform)).toEqual({ kind: "platform" });
    expect(classifyHost(null, platform)).toEqual({ kind: "platform" });
  });
  it("treats every other host as a custom domain", () => {
    expect(classifyHost("Reports.Agency.com:3000", platform)).toEqual({
      kind: "custom",
      host: "reports.agency.com",
    });
  });
  it("hostOf strips the port", () => {
    expect(hostOf("Example.com:8080")).toBe("example.com");
  });
});

describe("portalPathFor", () => {
  it("serves the portal at the root and under it", () => {
    expect(portalPathFor("/", "acme")).toBe("/portal/acme");
    expect(portalPathFor("/login", "acme")).toBe("/portal/acme/login");
    expect(portalPathFor("/reports/abc", "acme")).toBe("/portal/acme/reports/abc");
  });
  it("lets own portal paths through and refuses other agencies", () => {
    expect(portalPathFor("/portal/acme/reports", "acme")).toBe("/portal/acme/reports");
    expect(portalPathFor("/portal/acme", "acme")).toBe("/portal/acme");
    expect(portalPathFor("/portal/other", "acme")).toBeNull();
    expect(portalPathFor("/portal/acmex", "acme")).toBeNull();
  });
});

describe("dnsInstructions", () => {
  it("lists a CNAME and a TXT record", () => {
    expect(dnsInstructions("reports.agency.com", "app.platform.test", "tok")).toEqual([
      { type: "CNAME", name: "reports.agency.com", value: "app.platform.test" },
      { type: "TXT", name: "_portal-verify.reports.agency.com", value: "portal-verify=tok" },
    ]);
  });
});
