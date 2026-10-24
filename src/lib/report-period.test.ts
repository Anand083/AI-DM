import { describe, expect, it } from "vitest";
import { formatDay, PeriodError, periodLabel, resolvePeriod } from "./report-period";

const now = new Date("2026-03-10T15:00:00Z");
const utc = { now, timeZone: "UTC" };

describe("resolvePeriod", () => {
  it("last 7 days ends today and includes it", () => {
    expect(resolvePeriod({ kind: "last7" }, utc)).toEqual({
      start: "2026-03-04",
      end: "2026-03-10",
      label: "4 Mar 2026 to 10 Mar 2026",
    });
  });
  it("last 30 days", () => {
    const p = resolvePeriod({ kind: "last30" }, utc);
    expect([p.start, p.end]).toEqual(["2026-02-09", "2026-03-10"]);
  });
  it("last month is the whole previous calendar month", () => {
    expect(resolvePeriod({ kind: "lastMonth" }, utc)).toMatchObject({
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(
      resolvePeriod(
        { kind: "lastMonth" },
        { now: new Date("2026-01-15T00:00:00Z"), timeZone: "UTC" },
      ),
    ).toMatchObject({
      start: "2025-12-01",
      end: "2025-12-31",
    });
    expect(
      resolvePeriod(
        { kind: "lastMonth" },
        { now: new Date("2028-03-01T00:00:00Z"), timeZone: "UTC" },
      ),
    ).toMatchObject({ end: "2028-02-29" });
  });
  it("uses today's date in the agency time zone", () => {
    // 23:30 UTC on the 10th is already the 11th in Kolkata.
    const p = resolvePeriod(
      { kind: "last7" },
      { now: new Date("2026-03-10T23:30:00Z"), timeZone: "Asia/Kolkata" },
    );
    expect(p.end).toBe("2026-03-11");
    const west = resolvePeriod(
      { kind: "last7" },
      { now: new Date("2026-03-10T02:00:00Z"), timeZone: "America/Los_Angeles" },
    );
    expect(west.end).toBe("2026-03-09");
  });
  it("accepts custom dates inside the rules", () => {
    expect(
      resolvePeriod({ kind: "custom", start: "2026-01-01", end: "2026-03-10" }, utc),
    ).toMatchObject({ start: "2026-01-01", end: "2026-03-10" });
    expect(
      resolvePeriod({ kind: "custom", start: "2026-03-10", end: "2026-03-10" }, utc).label,
    ).toBe("10 Mar 2026 to 10 Mar 2026");
  });
  it("refuses bad custom dates with a plain message", () => {
    const bad = (input: Parameters<typeof resolvePeriod>[0]) => () => resolvePeriod(input, utc);
    expect(bad({ kind: "custom" })).toThrow(PeriodError);
    expect(bad({ kind: "custom", start: "2026-03-10" })).toThrow(/start date and an end date/);
    expect(bad({ kind: "custom", start: "2026-03-10", end: "2026-03-01" })).toThrow(
      /before the end date/,
    );
    expect(bad({ kind: "custom", start: "2026-03-01", end: "2026-03-11" })).toThrow(/future/);
    expect(bad({ kind: "custom", start: "2024-01-01", end: "2026-03-10" })).toThrow(
      /up to one year/,
    );
    expect(bad({ kind: "custom", start: "2026-13-45", end: "2026-13-46" })).toThrow(/real dates/);
    expect(bad({ kind: "custom", start: "yesterday", end: "today" })).toThrow(
      /start date and an end date/,
    );
  });
});

describe("formatting", () => {
  it("formats days and periods", () => {
    expect(formatDay("2026-03-05")).toBe("5 Mar 2026");
    expect(periodLabel("2026-03-01", "2026-03-31")).toBe("1 Mar 2026 to 31 Mar 2026");
  });
});
