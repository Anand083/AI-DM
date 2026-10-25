import { describe, expect, it } from "vitest";
import { addMonth, isOverdue, nextDueDay, priorityForSeverity } from "./tasks";

describe("addMonth", () => {
  it("keeps the day, and uses the last day when the month is shorter", () => {
    expect(addMonth("2026-03-15")).toBe("2026-04-15");
    expect(addMonth("2026-01-31")).toBe("2026-02-28");
    expect(addMonth("2028-01-31")).toBe("2028-02-29");
    expect(addMonth("2026-12-10")).toBe("2027-01-10");
  });
});

describe("nextDueDay", () => {
  it("is null for tasks that do not repeat", () => {
    expect(nextDueDay("2026-03-10", "NONE", "2026-03-10")).toBeNull();
  });

  it("follows the old due day when it is still ahead", () => {
    expect(nextDueDay("2026-03-12", "WEEKLY", "2026-03-10")).toBe("2026-03-19");
    expect(nextDueDay("2026-03-12", "MONTHLY", "2026-03-10")).toBe("2026-04-12");
  });

  it("never lands on or before today when the task was finished late", () => {
    expect(nextDueDay("2026-02-01", "WEEKLY", "2026-03-10")).toBe("2026-03-15");
    expect(nextDueDay("2025-01-05", "MONTHLY", "2026-03-10")).toBe("2026-04-05");
  });

  it("starts from today when there was no due day", () => {
    expect(nextDueDay(null, "WEEKLY", "2026-03-10")).toBe("2026-03-17");
  });
});

describe("helpers", () => {
  it("knows overdue tasks", () => {
    expect(isOverdue("2026-03-09", "2026-03-10", "TODO")).toBe(true);
    expect(isOverdue("2026-03-10", "2026-03-10", "TODO")).toBe(false);
    expect(isOverdue("2026-03-01", "2026-03-10", "DONE")).toBe(false);
    expect(isOverdue(null, "2026-03-10", "TODO")).toBe(false);
  });

  it("maps severity to priority", () => {
    expect(priorityForSeverity("CRITICAL")).toBe("HIGH");
    expect(priorityForSeverity("WARNING")).toBe("MEDIUM");
    expect(priorityForSeverity("NOTICE")).toBe("LOW");
  });
});
