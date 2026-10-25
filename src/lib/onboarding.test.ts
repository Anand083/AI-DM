import { describe, expect, it } from "vitest";
import { buildChecklist, checklistProgress, type ChecklistCounts } from "./onboarding";

const none: ChecklistCounts = {
  clients: 0,
  projects: 0,
  keywords: 0,
  audits: 0,
  branded: false,
  reports: 0,
};
const base = "/app/acme";

describe("buildChecklist", () => {
  it("starts with nothing done, in a helpful order", () => {
    const items = buildChecklist(none, base);
    expect(items.map((i) => i.key)).toEqual([
      "client",
      "project",
      "keywords",
      "audit",
      "branding",
      "report",
    ]);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items[0]!.href).toBe("/app/acme/clients/new");
  });

  it("marks each step by its own data", () => {
    const done = (counts: Partial<ChecklistCounts>) =>
      buildChecklist({ ...none, ...counts }, base)
        .filter((i) => i.done)
        .map((i) => i.key);
    expect(done({ clients: 2 })).toEqual(["client"]);
    expect(done({ projects: 1, keywords: 5 })).toEqual(["project", "keywords"]);
    expect(done({ audits: 1, branded: true, reports: 3 })).toEqual(["audit", "branding", "report"]);
  });

  it("uses plain English with no dashes", () => {
    for (const item of buildChecklist(none, base)) {
      expect(`${item.label} ${item.hint}`).not.toMatch(/[–—]/);
    }
  });
});

describe("checklistProgress", () => {
  it("counts steps and names the next one", () => {
    const items = buildChecklist({ ...none, clients: 1, projects: 1 }, base);
    const p = checklistProgress(items);
    expect(p).toMatchObject({ done: 2, total: 6, complete: false });
    expect(p.next?.key).toBe("keywords");
  });
  it("is complete when everything is done", () => {
    const items = buildChecklist(
      { clients: 1, projects: 1, keywords: 1, audits: 1, branded: true, reports: 1 },
      base,
    );
    expect(checklistProgress(items)).toMatchObject({
      done: 6,
      total: 6,
      complete: true,
      next: null,
    });
  });
});
