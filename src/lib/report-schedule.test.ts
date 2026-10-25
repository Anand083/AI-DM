import { describe, expect, it } from "vitest";
import { describeSchedule, isoWeekday, nextRunAt, zonedTimeToUtc } from "./report-schedule";

const weekly = (dayOfWeek: number, hour: number) =>
  ({ frequency: "WEEKLY", dayOfWeek, dayOfMonth: 1, hour }) as const;
const monthly = (dayOfMonth: number, hour: number) =>
  ({ frequency: "MONTHLY", dayOfWeek: 1, dayOfMonth, hour }) as const;
const iso = (d: Date) => d.toISOString();

describe("zonedTimeToUtc", () => {
  it("converts with and without daylight saving", () => {
    expect(iso(zonedTimeToUtc("2026-01-15", 8, "America/New_York"))).toBe(
      "2026-01-15T13:00:00.000Z",
    );
    expect(iso(zonedTimeToUtc("2026-07-15", 8, "America/New_York"))).toBe(
      "2026-07-15T12:00:00.000Z",
    );
    expect(iso(zonedTimeToUtc("2026-03-10", 8, "Asia/Kolkata"))).toBe("2026-03-10T02:30:00.000Z");
    expect(iso(zonedTimeToUtc("2026-03-10", 8, "UTC"))).toBe("2026-03-10T08:00:00.000Z");
  });
  it("uses the first moment for a repeated hour and the moment after a gap", () => {
    // New York clocks go back on 2026-11-01: 01:00 happens twice. Use the first (EDT, 05:00 UTC).
    expect(iso(zonedTimeToUtc("2026-11-01", 1, "America/New_York"))).toBe(
      "2026-11-01T05:00:00.000Z",
    );
    // Clocks go forward on 2026-03-08: 02:00 does not exist. Use 03:00 EDT (07:00 UTC).
    expect(iso(zonedTimeToUtc("2026-03-08", 2, "America/New_York"))).toBe(
      "2026-03-08T07:00:00.000Z",
    );
  });
});

describe("isoWeekday", () => {
  it("is 1 for Monday and 7 for Sunday", () => {
    expect(isoWeekday("2026-03-09")).toBe(1);
    expect(isoWeekday("2026-03-15")).toBe(7);
  });
});

describe("nextRunAt weekly", () => {
  it("finds the next matching weekday", () => {
    // 2026-03-10 is a Tuesday. Next Monday 08:00 UTC is the 16th.
    expect(iso(nextRunAt(weekly(1, 8), new Date("2026-03-10T09:00:00Z"), "UTC"))).toBe(
      "2026-03-16T08:00:00.000Z",
    );
  });
  it("runs later the same day if the hour has not passed", () => {
    expect(iso(nextRunAt(weekly(2, 8), new Date("2026-03-10T07:59:00Z"), "UTC"))).toBe(
      "2026-03-10T08:00:00.000Z",
    );
  });
  it("moves a full week when the time is exactly now", () => {
    expect(iso(nextRunAt(weekly(2, 8), new Date("2026-03-10T08:00:00Z"), "UTC"))).toBe(
      "2026-03-17T08:00:00.000Z",
    );
  });
  it("uses the agency time zone", () => {
    // Tuesday 08:00 in Kolkata is 02:30 UTC. At 03:00 UTC on Tuesday that has passed.
    expect(iso(nextRunAt(weekly(2, 8), new Date("2026-03-10T03:00:00Z"), "Asia/Kolkata"))).toBe(
      "2026-03-17T02:30:00.000Z",
    );
    // In Los Angeles it is still Monday evening at 03:00 UTC Tuesday, so Tuesday 08:00 PDT (15:00 UTC) is next.
    expect(
      iso(nextRunAt(weekly(2, 8), new Date("2026-03-10T03:00:00Z"), "America/Los_Angeles")),
    ).toBe("2026-03-10T15:00:00.000Z");
  });
  it("keeps the local hour across a daylight saving change", () => {
    const first = nextRunAt(weekly(1, 8), new Date("2026-03-02T14:00:00Z"), "America/New_York");
    expect(iso(first)).toBe("2026-03-09T12:00:00.000Z");
    // The week before clocks change (Mar 8), the Monday run is at 13:00 UTC; after it, 12:00 UTC.
    expect(iso(nextRunAt(weekly(1, 8), new Date("2026-03-01T00:00:00Z"), "America/New_York"))).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });
});

describe("nextRunAt monthly", () => {
  it("picks the day this month or next month", () => {
    expect(iso(nextRunAt(monthly(15, 6), new Date("2026-03-10T00:00:00Z"), "UTC"))).toBe(
      "2026-03-15T06:00:00.000Z",
    );
    expect(iso(nextRunAt(monthly(5, 6), new Date("2026-03-10T00:00:00Z"), "UTC"))).toBe(
      "2026-04-05T06:00:00.000Z",
    );
  });
  it("handles month ends and year ends with day 28", () => {
    expect(iso(nextRunAt(monthly(28, 9), new Date("2026-02-28T09:00:00Z"), "UTC"))).toBe(
      "2026-03-28T09:00:00.000Z",
    );
    expect(iso(nextRunAt(monthly(28, 9), new Date("2026-12-29T00:00:00Z"), "UTC"))).toBe(
      "2027-01-28T09:00:00.000Z",
    );
  });
  it("handles day 1 in a zone ahead of UTC", () => {
    // 2026-03-31T20:00Z is already April 1 in Kolkata (01:30). Day 1 at 08:00 there is 02:30 UTC the same day, but that is still in the future.
    expect(iso(nextRunAt(monthly(1, 8), new Date("2026-03-31T20:00:00Z"), "Asia/Kolkata"))).toBe(
      "2026-04-01T02:30:00.000Z",
    );
  });
});

describe("describeSchedule", () => {
  it("writes plain English", () => {
    expect(describeSchedule(weekly(3, 9))).toBe("Every Wednesday at 09:00");
    expect(describeSchedule(monthly(1, 14))).toBe("On day 1 of every month at 14:00");
  });
});
