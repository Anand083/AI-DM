import { describe, expect, it } from "vitest";
import { localParts } from "./local-time";

describe("localParts", () => {
  it("gives the date and hour in the zone", () => {
    const at = new Date("2026-03-10T23:30:00Z");
    expect(localParts(at, "UTC")).toEqual({ date: "2026-03-10", hour: 23 });
    expect(localParts(at, "Asia/Kolkata")).toEqual({ date: "2026-03-11", hour: 5 });
    expect(localParts(at, "America/New_York")).toEqual({ date: "2026-03-10", hour: 19 });
  });
  it("handles midnight as hour 0, not 24", () => {
    expect(localParts(new Date("2026-03-10T00:10:00Z"), "UTC").hour).toBe(0);
  });
  it("follows daylight saving time", () => {
    // US clocks go forward on 2026-03-08.
    expect(localParts(new Date("2026-03-07T12:00:00Z"), "America/New_York").hour).toBe(7);
    expect(localParts(new Date("2026-03-09T12:00:00Z"), "America/New_York").hour).toBe(8);
  });
});
