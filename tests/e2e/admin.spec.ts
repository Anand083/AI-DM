import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { activityActions, makeSuperAdmin } from "./db";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("non-admins get a 404 for the admin area", async ({ page }) => {
  // Signed out.
  const loggedOut = await page.goto("/admin");
  expect(loggedOut?.status()).toBe(404);
  // Signed in, but not an admin.
  await signUpAndVerify(page, newEmail("plain"), "Pat Plain");
  for (const path of [
    "/admin",
    "/admin/agencies",
    "/admin/queues",
    "/admin/plans",
    "/admin/settings",
    "/admin/providers",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("a super admin runs the platform: overview, suspend, support session, provider test", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  // An agency with an owner.
  const ownerEmail = newEmail("owner");
  await signUpAndVerify(page, ownerEmail, "Olivia Owner");
  const agencyName = `Admin Target ${Date.now()}`;
  const slug = await createAgencyInUi(page, agencyName);

  // The admin, in a separate browser.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const adminEmail = newEmail("admin");
  await signUpAndVerify(admin, adminEmail, "Ada Admin");
  await makeSuperAdmin(adminEmail);

  // Overview and accessibility.
  await admin.goto("/admin");
  await expect(admin.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(admin.getByText("Monthly revenue (MRR)")).toBeVisible();
  await expect(admin.getByText("Gross margin")).toBeVisible();
  const results = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Find the agency by searching.
  await admin.goto("/admin/agencies");
  await admin.getByLabel("Search agencies").fill(agencyName);
  await admin.keyboard.press("Enter");
  await admin.getByRole("link", { name: agencyName }).click();
  await expect(admin.getByRole("heading", { name: agencyName, level: 1 })).toBeVisible();
  await expect(admin.getByText(ownerEmail)).toBeVisible();

  // Suspend: the owner sees the suspended page. Unsuspend: back to normal.
  await admin.getByRole("button", { name: "Suspend", exact: true }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(admin.getByText("suspended", { exact: true }).first()).toBeVisible();
  await page.goto(`/app/${slug}`);
  await expect(page.getByRole("heading", { name: "This account is suspended" })).toBeVisible();
  await admin.getByRole("button", { name: "Unsuspend" }).click();
  await expect(admin.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();
  await page.goto(`/app/${slug}`);
  await expect(page.getByRole("heading", { name: agencyName, level: 1 })).toBeVisible();

  // Support session: red banner, billing hidden, actions are logged with the admin.
  await admin.getByRole("button", { name: "View as this agency" }).click();
  await expect(admin).toHaveURL(new RegExp(`/app/${slug}$`));
  const banner = admin.getByTestId("support-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`viewing ${agencyName} as Olivia Owner`);
  await admin.goto(`/app/${slug}/billing`);
  await expect(admin.getByText("Billing is not available during a support session.")).toBeVisible();
  await admin.goto(`/app/${slug}/clients/new`);
  await admin.getByLabel("Client name").fill("Added By Support");
  await admin.getByRole("button", { name: "Add client" }).click();
  await expect(admin.getByRole("heading", { name: "Added By Support" })).toBeVisible();
  // The admin area is closed during a support session.
  expect((await admin.goto("/admin"))?.status()).toBe(200);
  await admin.goto(`/app/${slug}`);
  await admin.getByRole("button", { name: "End session" }).click();
  await expect(admin).toHaveURL(/\/admin$/);
  await admin.goto(`/app/${slug}`);
  expect((await admin.goto(`/app/${slug}`))?.status()).toBe(404);

  const log = await activityActions(slug);
  const created = log.find((l) => l.action === "client.created");
  expect(created?.impersonated).toBe(true);
  expect(log.map((l) => l.action)).toEqual(
    expect.arrayContaining([
      "admin.suspended",
      "admin.unsuspended",
      "admin.impersonation_started",
      "admin.impersonation_ended",
    ]),
  );

  // The agency page in the admin area shows those actions in its log.
  await admin.goto("/admin/agencies");
  await admin.getByLabel("Search agencies").fill(agencyName);
  await admin.keyboard.press("Enter");
  await admin.getByRole("link", { name: agencyName }).click();
  const activity = admin.getByRole("list", { name: "Activity log" });
  await expect(activity.getByText("client.created")).toBeVisible();
  await expect(activity.getByText("by support").first()).toBeVisible();

  // Queues and the data provider page.
  await admin.goto("/admin/queues");
  const table = admin.getByRole("table", { name: "Queues" });
  await expect(table.getByText("rank-checks")).toBeVisible();
  await expect(table.getByText("emails")).toBeVisible();
  await admin.goto("/admin/providers");
  await expect(admin.getByTestId("default-provider")).toHaveText("mock");
  await admin.getByRole("button", { name: "Test connection (mock)" }).click();
  await expect(admin.getByText("Connection works.")).toBeVisible();
  await expect(admin.getByRole("textbox", { name: "pingback address" })).toHaveValue(
    /\/api\/providers\/dataforseo\/pingback$/,
  );

  // Plans and settings open (not changed here, because other tests share the same plans).
  await admin.goto("/admin/plans");
  await expect(admin.getByRole("form", { name: "Starter plan" })).toBeVisible();
  await admin.goto("/admin/settings");
  await expect(admin.getByRole("heading", { name: "Maintenance mode" })).toBeVisible();
  await expect(admin.getByLabel("Provider budget per month (USD)")).toBeVisible();

  await adminContext.close();
});
