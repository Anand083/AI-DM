import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { insertAlert } from "./db";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("an alert shows up in the bell, can be opened, and can be marked as read", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("alerts"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Alerts Test ${Date.now()}`);

  // Quiet at first.
  await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
  await expect(
    page.getByText("Nothing yet. Alerts show up here when rankings move a lot."),
  ).toBeVisible();

  // The worker would create this after a rank check that found a big drop.
  await insertAlert(slug, null, "3 keywords dropped for Bright Dental", `e2e-${Date.now()}`);
  await page.reload();
  const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
  await expect(bell).toBeVisible();
  await expect(
    page.getByText("Unread alerts").locator("..").getByText("1", { exact: true }),
  ).toBeVisible();

  await bell.click();
  await expect(
    page.getByRole("menuitem", { name: "3 keywords dropped for Bright Dental" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "See all alerts" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slug}/alerts$`));

  // The alerts page, with an unread filter.
  await expect(page.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "3 keywords dropped for Bright Dental" }),
  ).toBeVisible();
  await expect(page.getByText("New", { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  await page.getByRole("button", { name: /Mark as read/ }).click();
  await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText("New", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: /^Unread/ }).click();
  await expect(page.getByText("No unread alerts")).toBeVisible();
});

test("mark all as read clears the bell", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("alerts2"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Alerts Two ${Date.now()}`);
  for (const n of [1, 2, 3])
    await insertAlert(slug, null, `Alert number ${n}`, `e2e-all-${Date.now()}-${n}`);
  await page.goto(`/app/${slug}/alerts`);
  await expect(page.getByRole("button", { name: "Notifications, 3 unread" })).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "All alerts marked as read." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});

test("alert settings can be changed", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("alerts3"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Alerts Three ${Date.now()}`);
  await page.goto(`/app/${slug}/settings`);
  await expect(page.getByLabel("Drop of at least (places)")).toHaveValue("5");
  await page.getByLabel("Drop of at least (places)").fill("8");
  await page.getByLabel("Email owners and admins a summary of new alerts every morning").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Drop of at least (places)")).toHaveValue("8");
  await expect(
    page.getByLabel("Email owners and admins a summary of new alerts every morning"),
  ).toBeChecked();
});
