import { describe, expect, it } from "vitest";
import { ACTIONS, can, canManageMember, scopeOf, type Action, type Role } from "./permissions";

const O = "OWNER",
  A = "ADMIN",
  M = "MEMBER",
  C = "CLIENT";

// Written out by hand from plan section 8, so a mistake in the table is caught here.
const expected: Record<Action, Record<Role, "all" | "own" | "none">> = {
  "data.view": { [O]: "all", [A]: "all", [M]: "all", [C]: "own" },
  "content.edit": { [O]: "all", [A]: "all", [M]: "all", [C]: "none" },
  "content.delete": { [O]: "all", [A]: "all", [M]: "none", [C]: "none" },
  "tools.run": { [O]: "all", [A]: "all", [M]: "all", [C]: "none" },
  "reports.create": { [O]: "all", [A]: "all", [M]: "all", [C]: "none" },
  "reports.download": { [O]: "all", [A]: "all", [M]: "all", [C]: "own" },
  "team.manage": { [O]: "all", [A]: "all", [M]: "none", [C]: "none" },
  "clientUsers.invite": { [O]: "all", [A]: "all", [M]: "all", [C]: "none" },
  "branding.edit": { [O]: "all", [A]: "all", [M]: "none", [C]: "none" },
  "billing.manage": { [O]: "all", [A]: "none", [M]: "none", [C]: "none" },
  "agency.manage": { [O]: "all", [A]: "none", [M]: "none", [C]: "none" },
};

describe("can() permission table", () => {
  it("covers every action", () => {
    expect(Object.keys(expected).sort()).toEqual([...ACTIONS].sort());
  });

  for (const action of ACTIONS) {
    for (const role of [O, A, M, C] as const) {
      it(`${role} on ${action} is ${expected[action][role]}`, () => {
        expect(scopeOf(role, action)).toBe(expected[action][role]);
        expect(can(role, action)).toBe(expected[action][role] !== "none");
      });
    }
  }
});

describe("canManageMember", () => {
  it("owner can manage admins and members, not clients", () => {
    expect(canManageMember(O, O)).toBe(true);
    expect(canManageMember(O, A)).toBe(true);
    expect(canManageMember(O, M)).toBe(true);
    expect(canManageMember(O, C)).toBe(false);
  });
  it("admin can manage admins and members, never owners", () => {
    expect(canManageMember(A, O)).toBe(false);
    expect(canManageMember(A, A)).toBe(true);
    expect(canManageMember(A, M)).toBe(true);
  });
  it("members and clients manage nobody", () => {
    for (const target of [O, A, M, C] as const) {
      expect(canManageMember(M, target)).toBe(false);
      expect(canManageMember(C, target)).toBe(false);
    }
  });
});
