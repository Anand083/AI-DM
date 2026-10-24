import { can, type Action, type Role } from "@/server/auth/permissions";

export type NavKey =
  | "dashboard"
  | "clients"
  | "projects"
  | "reports"
  | "team"
  | "branding"
  | "billing"
  | "usage"
  | "settings";

export type NavItem = { key: NavKey; label: string; path: string; permission: Action };

/** The sidebar, in order. `path` is added after `/app/[agencySlug]`. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", path: "", permission: "data.view" },
  { key: "clients", label: "Clients", path: "/clients", permission: "data.view" },
  { key: "projects", label: "Projects", path: "/projects", permission: "data.view" },
  { key: "reports", label: "Reports", path: "/reports", permission: "data.view" },
  { key: "team", label: "Team", path: "/team", permission: "data.view" },
  { key: "branding", label: "Branding", path: "/branding", permission: "branding.edit" },
  { key: "billing", label: "Billing", path: "/billing", permission: "billing.manage" },
  { key: "usage", label: "Usage", path: "/usage", permission: "branding.edit" },
  { key: "settings", label: "Settings", path: "/settings", permission: "data.view" },
];

/** The menu items this role may open. */
export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => can(role, item.permission));
}

/** The page behind a nav item must check the same permission (see `requirePermission`). */
export function permissionForPath(path: string): Action | undefined {
  return NAV_ITEMS.find((item) => item.path === path)?.permission;
}
