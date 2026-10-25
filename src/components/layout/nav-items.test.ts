import { describe, expect, it } from "vitest";
import { navItemsFor } from "./nav-items";

const keys = (role: Parameters<typeof navItemsFor>[0]) => navItemsFor(role).map((i) => i.key);

describe("navItemsFor", () => {
  it("shows everything to owners", () => {
    expect(keys("OWNER")).toEqual([
      "dashboard",
      "clients",
      "projects",
      "research",
      "reports",
      "tasks",
      "leads",
      "team",
      "branding",
      "billing",
      "usage",
      "settings",
      "help",
    ]);
  });
  it("hides billing from admins", () => {
    expect(keys("ADMIN")).not.toContain("billing");
    expect(keys("ADMIN")).toContain("branding");
  });
  it("shows leads to members too", () => {
    expect(keys("MEMBER")).toContain("leads");
  });
  it("hides branding, billing and usage from members", () => {
    const list = keys("MEMBER");
    for (const hidden of ["branding", "billing", "usage"]) expect(list).not.toContain(hidden);
    expect(list).toContain("team");
  });
});
