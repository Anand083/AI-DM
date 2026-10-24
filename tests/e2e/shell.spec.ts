import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

async function ownerWithAgency(page: Page): Promise<string> {
  await signUpAndVerify(page, newEmail("shell"), "Olivia Owner");
  return createAgencyInUi(page, `Shell Test ${Date.now()}`);
}

const MENU = [
  ["Dashboard", ""],
  ["Clients", "/clients"],
  ["Projects", "/projects"],
  ["Reports", "/reports"],
  ["Team", "/team"],
  ["Branding", "/branding"],
  ["Billing", "/billing"],
  ["Usage", "/usage"],
  ["Settings", "/settings"],
] as const;

test("every menu item opens without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const slug = await ownerWithAgency(page);

  const nav = page.getByRole("navigation", { name: "Main" }).first();
  for (const [label, path] of MENU) {
    const response = await Promise.all([
      page.waitForURL(new RegExp(`/app/${slug}${path}$`)),
      nav.getByRole("link", { name: label, exact: true }).click(),
    ]);
    void response;
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  expect(errors).toEqual([]);
});

test("the top bar shows the agency switcher, demo badge, bell and user menu", async ({ page }) => {
  await ownerWithAgency(page);
  await expect(page.getByLabel("Switch agency")).toBeVisible();
  await expect(page.getByText("Demo data")).toBeVisible();
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText("You have no notifications yet.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Olivia Owner/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("settings can be changed and show a confirmation", async ({ page }) => {
  const slug = await ownerWithAgency(page);
  await page.goto(`/app/${slug}/settings`);
  const newName = `Renamed ${Date.now()}`;
  // The form fills in the current name once the page is ready.
  await expect(page.getByLabel("Agency name")).toHaveValue(/^Shell Test/);
  await page.getByLabel("Agency name").fill(newName);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Agency name")).toHaveValue(newName);
});

test("the menu works on a phone-sized screen", async ({ page }) => {
  const slug = await ownerWithAgency(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/app/${slug}`);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slug}/team$`));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

for (const [name, path] of [
  ["dashboard", ""],
  ["settings", "/settings"],
  ["team", "/team"],
] as const) {
  test(`${name} has no serious accessibility problems`, async ({ page }) => {
    const slug = await ownerWithAgency(page);
    await page.goto(`/app/${slug}${path}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);
  });
}
