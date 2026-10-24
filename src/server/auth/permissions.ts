import type { MemberRole } from "@prisma/client";

/** Roles that can sit in a TenantContext. CLIENT users only use the portal. */
export type Role = MemberRole | "CLIENT";

export const ROLES: readonly Role[] = ["OWNER", "ADMIN", "MEMBER", "CLIENT"];

export const ACTIONS = [
  "data.view",
  "content.edit",
  "content.delete",
  "tools.run",
  "reports.create",
  "reports.download",
  "team.manage",
  "clientUsers.invite",
  "branding.edit",
  "billing.manage",
  "agency.manage",
] as const;

export type Action = (typeof ACTIONS)[number];

/** "own" means the client user may only see data of their own client. Callers must enforce it. */
export type Scope = "all" | "own" | "none";

const A: Scope = "all";
const N: Scope = "none";
const O: Scope = "own";

/** The permission table from plan section 8. One row per action: Owner, Admin, Member, Client. */
const TABLE: Record<Action, Record<Role, Scope>> = {
  "data.view": { OWNER: A, ADMIN: A, MEMBER: A, CLIENT: O },
  "content.edit": { OWNER: A, ADMIN: A, MEMBER: A, CLIENT: N },
  "content.delete": { OWNER: A, ADMIN: A, MEMBER: N, CLIENT: N },
  "tools.run": { OWNER: A, ADMIN: A, MEMBER: A, CLIENT: N },
  "reports.create": { OWNER: A, ADMIN: A, MEMBER: A, CLIENT: N },
  "reports.download": { OWNER: A, ADMIN: A, MEMBER: A, CLIENT: O },
  // Admins can manage team members, but never owners. See `canManageMember`.
  "team.manage": { OWNER: A, ADMIN: A, MEMBER: N, CLIENT: N },
  "clientUsers.invite": { OWNER: A, ADMIN: A, MEMBER: A, CLIENT: N },
  "branding.edit": { OWNER: A, ADMIN: A, MEMBER: N, CLIENT: N },
  "billing.manage": { OWNER: A, ADMIN: N, MEMBER: N, CLIENT: N },
  "agency.manage": { OWNER: A, ADMIN: N, MEMBER: N, CLIENT: N },
};

export function scopeOf(role: Role, action: Action): Scope {
  return TABLE[action][role];
}

export function can(role: Role, action: Action): boolean {
  return scopeOf(role, action) !== "none";
}

/** Whether `actor` may change or remove a member who has the `target` role. */
export function canManageMember(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return target !== "CLIENT";
  if (actor === "ADMIN") return target === "ADMIN" || target === "MEMBER";
  return false;
}

/** Roles that can be given by invitation to team members. Owners cannot be invited. */
export const TEAM_INVITE_ROLES = ["ADMIN", "MEMBER"] as const;
