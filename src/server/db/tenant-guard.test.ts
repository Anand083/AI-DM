import { describe, expect, it } from "vitest";
import {
  assertTenantScoped,
  isGuardEnabled,
  TenantGuardError,
  TENANT_MODELS,
} from "./tenant-guard";

const A = "agency_a";

describe("assertTenantScoped", () => {
  it("ignores models that are not tenant-owned", () => {
    expect(() => assertTenantScoped("User", "findMany", {})).not.toThrow();
    expect(() => assertTenantScoped("Plan", "deleteMany", { where: {} })).not.toThrow();
  });

  it("throws when a read has no agencyId", () => {
    expect(() => assertTenantScoped("Client", "findMany", {})).toThrow(TenantGuardError);
    expect(() => assertTenantScoped("Client", "findMany", { where: { name: "x" } })).toThrow();
    expect(() => assertTenantScoped("Client", "findUnique", { where: { id: "c1" } })).toThrow();
  });

  it("passes when agencyId is in where", () => {
    expect(() =>
      assertTenantScoped("Client", "findMany", { where: { agencyId: A } }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped("Client", "findUnique", { where: { id: "c1", agencyId: A } }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped("Project", "count", { where: { agencyId: { equals: A } } }),
    ).not.toThrow();
  });

  it("accepts agencyId inside a compound unique key", () => {
    expect(() =>
      assertTenantScoped("AgencyMember", "findUnique", {
        where: { agencyId_userId: { agencyId: A, userId: "u1" } },
      }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped("ClientUser", "upsert", {
        where: { clientId_userId: { clientId: "c", userId: "u" }, agencyId: A },
        create: { agencyId: A, clientId: "c", userId: "u" },
        update: {},
      }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped("ClientUser", "findUnique", {
        where: { clientId_userId: { clientId: "c", userId: "u" } },
      }),
    ).toThrow();
  });

  it("accepts agencyId inside AND", () => {
    expect(() =>
      assertTenantScoped("Client", "findMany", {
        where: { AND: [{ agencyId: A }, { name: "x" }] },
      }),
    ).not.toThrow();
  });

  it("does not accept agencyId hidden in OR, an empty value, or undefined", () => {
    expect(() =>
      assertTenantScoped("Client", "findMany", { where: { OR: [{ agencyId: A }, { name: "x" }] } }),
    ).toThrow();
    expect(() => assertTenantScoped("Client", "findMany", { where: { agencyId: "" } })).toThrow();
    expect(() =>
      assertTenantScoped("Client", "findMany", { where: { agencyId: undefined } }),
    ).toThrow();
  });

  it("guards updates and deletes", () => {
    for (const op of ["update", "updateMany", "delete", "deleteMany"]) {
      expect(() => assertTenantScoped("Project", op, { where: { id: "p1" } })).toThrow();
      expect(() =>
        assertTenantScoped("Project", op, { where: { id: "p1", agencyId: A } }),
      ).not.toThrow();
    }
  });

  it("guards create and createMany data", () => {
    expect(() => assertTenantScoped("Client", "create", { data: { name: "x" } })).toThrow();
    expect(() =>
      assertTenantScoped("Client", "create", { data: { name: "x", agencyId: A } }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped("Client", "create", {
        data: { name: "x", agency: { connect: { id: A } } },
      }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped("Client", "createMany", {
        data: [{ name: "x", agencyId: A }, { name: "y" }],
      }),
    ).toThrow();
    expect(() =>
      assertTenantScoped("Client", "createMany", { data: [{ name: "x", agencyId: A }] }),
    ).not.toThrow();
  });

  it("checks both sides of an upsert", () => {
    expect(() =>
      assertTenantScoped("Client", "upsert", {
        where: { id: "c", agencyId: A },
        create: { name: "x" },
        update: {},
      }),
    ).toThrow();
    expect(() =>
      assertTenantScoped("Client", "upsert", {
        where: { id: "c", agencyId: A },
        create: { name: "x", agencyId: A },
        update: {},
      }),
    ).not.toThrow();
  });

  it("covers every tenant model in the schema", () => {
    expect([...TENANT_MODELS].sort()).toEqual([
      "ActivityLog",
      "AgencyMember",
      "Client",
      "ClientUser",
      "Invitation",
      "Project",
      "Subscription",
    ]);
  });
});

describe("isGuardEnabled", () => {
  it("is on in development and test, off in production", () => {
    expect(isGuardEnabled("development")).toBe(true);
    expect(isGuardEnabled("test")).toBe(true);
    expect(isGuardEnabled("production")).toBe(false);
  });
});
