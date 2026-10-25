import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify, waitForHydration } from "./helpers";

test("search, save a view, archive clients in bulk and hide a dashboard part", async ({ page }) => {
  test.setTimeout(150_000);
  await signUpAndVerify(page, newEmail("ux"), "Uma Ux");
  const slug = await createAgencyInUi(page, `Ux ${Date.now()}`);

  // Two clients through the CSV import.
  await page.goto(`/app/${slug}/clients/import`);
  await waitForHydration(page, "form");
  await page.getByLabel("Or paste CSV text").fill("client\nMango Farm\nMaple Shop");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 2 clients" })).toBeVisible();

  // Header search finds a client.
  await page.goto(`/app/${slug}`);
  await page.getByLabel("Find anything").first().fill("mango");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=mango/);
  await expect(page.getByRole("link", { name: "Mango Farm" })).toBeVisible();
  await expect(page.getByText("Maple Shop")).toHaveCount(0);
  await page.goto(`/app/${slug}/search?q=zzzzzz`);
  await expect(page.getByText("Nothing found")).toBeVisible();

  // Save a view of the filtered client list, then open it from the saved list.
  await page.goto(`/app/${slug}/clients?q=Ma`);
  await waitForHydration(page, "form");
  await page.getByLabel("Save these filters as a view").fill("Ma clients");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByText("View saved.")).toBeVisible();
  await page.goto(`/app/${slug}/clients`);
  await page.getByRole("link", { name: "Ma clients" }).click();
  await expect(page).toHaveURL(/clients\?q=Ma/);

  // Bulk archive both.
  await page.goto(`/app/${slug}/clients`);
  await waitForHydration(page, "form");
  await page.getByLabel("Select Mango Farm").check();
  await page.getByLabel("Select Maple Shop").check();
  await page.getByLabel("With selected rows").selectOption("archive");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("2 updated.")).toBeVisible();
  await expect(page.getByText("No clients yet")).toBeVisible();

  // Hide a dashboard part.
  await page.goto(`/app/${slug}`);
  await waitForHydration(page, "form, summary");
  await page.getByText("Customize dashboard").click();
  await page.getByLabel("Clients overview").uncheck();
  await page.getByRole("button", { name: "Save dashboard" }).click();
  await expect(page.getByText("Dashboard saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
