import { describe, expect, it } from "vitest";
import {
  clickChange,
  conversionRate,
  dimensionFromParam,
  engagedPercent,
  labelBreakdownKey,
} from "./google-insights";

describe("google insights helpers", () => {
  it("reads the tab from the address and falls back to queries", () => {
    expect(dimensionFromParam("country")).toBe("COUNTRY");
    expect(dimensionFromParam("device")).toBe("DEVICE");
    expect(dimensionFromParam("nonsense")).toBe("QUERY");
    expect(dimensionFromParam(undefined)).toBe("QUERY");
  });

  it("names countries and devices in plain English", () => {
    expect(labelBreakdownKey("DEVICE", "MOBILE")).toBe("Phone");
    expect(labelBreakdownKey("DEVICE", "WEIRD")).toBe("WEIRD");
    expect(labelBreakdownKey("COUNTRY", "usa")).toBe("United States");
    expect(labelBreakdownKey("COUNTRY", "zzz")).toBe("ZZZ");
    expect(labelBreakdownKey("QUERY", "seo agency")).toBe("seo agency");
  });

  it("works out change and rates", () => {
    expect(clickChange(150, 100)).toBe(50);
    expect(clickChange(50, 100)).toBe(-50);
    expect(clickChange(10, undefined)).toBeNull();
    expect(clickChange(10, 0)).toBeNull();
    expect(engagedPercent(30, 40)).toBe(75);
    expect(engagedPercent(0, 0)).toBe(0);
    expect(conversionRate(3, 125)).toBe("2.4%");
    expect(conversionRate(0, 0)).toBe("0%");
  });
});
