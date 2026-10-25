import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("link a business, check reviews, read a suggested reply", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("reviews"), "Rita Reviews");
  const slug = await createAgencyInUi(page, `Reviews Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Bright Dental");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Dental site");
  await page.getByLabel("Website domain").fill("brightdental.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Dental site" })
    .click();

  await page.getByRole("link", { name: "Reviews", exact: true }).click();
  await expect(page.getByText("No business linked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check reviews" })).toHaveCount(0);

  // Name too short, then a good one.
  await page.getByLabel("Business name").fill("B");
  await page.getByRole("button", { name: "Link business" }).click();
  await expect(page.getByText("Enter the business name.")).toBeVisible();
  await page.getByLabel("Business name").fill("Bright Dental Clinic");
  await page.getByLabel("City (optional)").fill("Austin");
  await page.getByRole("button", { name: "Link business" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Business linked." })).toBeVisible();

  // The worker reads the reviews. (The daily scheduler may also have queued it.)
  await expect(page.getByText("No review data yet")).toBeVisible();
  await page.getByRole("button", { name: "Check reviews" }).click();
  await expect(page.getByText("Average rating")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/^\d\.\d out of 5$/)).toBeVisible();
  await expect(page.getByText("Already checked today.")).toBeVisible();

  const reviews = page.getByRole("list", { name: "Reviews", exact: true });
  await expect(reviews.getByRole("listitem")).toHaveCount(8);
  await reviews.getByText("Suggested reply").first().click();
  await expect(page.getByText("Read it and change it before you post it.").first()).toBeVisible();

  // Filter and accessibility.
  await page.getByRole("link", { name: "1 and 2 stars" }).click();
  await expect(page).toHaveURL(/filter=low/);
  await page.getByRole("link", { name: "All reviews" }).click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Stop tracking.
  await page.getByRole("button", { name: "Stop tracking reviews" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Stop tracking" }).click();
  await expect(page.getByText("No business linked")).toBeVisible();
});
