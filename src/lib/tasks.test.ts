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

import { BUILT_IN_TEMPLATES, parseTemplateLines, progressPercent, templateDueDay } from "./tasks";

describe("parseTemplateLines", () => {
  it("reads title, days and priority, with defaults", () => {
    const { items, errors } = parseTemplateLines(
      "Audit the site | 3 | high\n\n  Write the report  \nCall the client | 0 | URGENT",
    );
    expect(errors).toEqual([]);
    expect(items.map((i) => [i.title, i.days, i.priority])).toEqual([
      ["Audit the site", 3, "HIGH"],
      ["Write the report", 7, "MEDIUM"],
      ["Call the client", 0, "URGENT"],
    ]);
  });

  it("explains each bad line by number", () => {
    const { items, errors } = parseTemplateLines(
      "ok title | 400\nab\nGood one | 5 | soon\nFine | 2",
    );
    expect(items.map((i) => i.title)).toEqual(["Fine"]);
    expect(errors).toEqual([
      "Line 1: days must be a number from 0 to 365.",
      "Line 2: the title needs 3 to 200 characters.",
      "Line 3: priority must be low, medium, high or urgent.",
    ]);
  });

  it("needs at least one task and at most 50", () => {
    expect(parseTemplateLines("  \n\n").errors).toEqual(["Write at least one task."]);
    expect(
      parseTemplateLines(Array.from({ length: 51 }, (_, i) => `Task number ${i}`).join("\n"))
        .errors,
    ).toEqual(["Use 50 tasks or fewer."]);
  });
});

describe("templates and progress", () => {
  it("built-in templates are valid", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.items.length).toBeGreaterThan(2);
      for (const i of t.items) {
        expect(i.title.length).toBeGreaterThanOrEqual(3);
        expect(i.days).toBeGreaterThanOrEqual(0);
      }
    }
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.key)).size).toBe(BUILT_IN_TEMPLATES.length);
  });

  it("works out due days and progress", () => {
    expect(templateDueDay("2026-03-30", 5)).toBe("2026-04-04");
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(3, 3)).toBe(100);
    expect(progressPercent(0, 0)).toBeNull();
  });
});
