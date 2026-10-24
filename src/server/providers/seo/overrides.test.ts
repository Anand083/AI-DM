import { describe, expect, it } from "vitest";
import { parseOverrides, providersInUse, resolveProviderName } from "./overrides";

describe("parseOverrides", () => {
  it("reads a list", () => {
    expect(parseOverrides("rankings=dataforseo, audit=mock")).toEqual({
      overrides: { rankings: "dataforseo", audit: "mock" },
      problems: [],
    });
  });
  it("accepts an empty value", () => {
    expect(parseOverrides("")).toEqual({ overrides: {}, problems: [] });
    expect(parseOverrides(" , ")).toEqual({ overrides: {}, problems: [] });
  });
  it("reports every problem", () => {
    const { overrides, problems } = parseOverrides(
      "rankings=oops,nonsense=mock,audit,backlinks=mock=x,ai=mock",
    );
    expect(overrides).toEqual({ ai: "mock" });
    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toMatch(/unknown provider "oops"/);
    expect(problems.join(" ")).toMatch(/unknown module "nonsense"/);
  });
});

describe("resolveProviderName", () => {
  it("uses the override, else the default", () => {
    const overrides = { rankings: "dataforseo" } as const;
    expect(resolveProviderName("rankings", "mock", overrides)).toBe("dataforseo");
    expect(resolveProviderName("audit", "mock", overrides)).toBe("mock");
    expect(resolveProviderName(undefined, "mock", overrides)).toBe("mock");
  });
});

describe("providersInUse", () => {
  it("lists every provider some module uses", () => {
    expect([...providersInUse("mock", {})]).toEqual(["mock"]);
    expect([...providersInUse("mock", { rankings: "dataforseo" })].sort()).toEqual([
      "dataforseo",
      "mock",
    ]);
    expect([...providersInUse("dataforseo", { audit: "mock" })].sort()).toEqual([
      "dataforseo",
      "mock",
    ]);
  });
});
