import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify, waitForHydration } from "./helpers";

test("import clients from CSV, set a retainer and read the profit estimate", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("ops"), "Opal Ops");
  const slug = await createAgencyInUi(page, `Ops ${Date.now()}`);

  // Import two clients, one with a project.
  await page.goto(`/app/${slug}/clients/import`);
  await waitForHydration(page, "form");
  await page
    .getByLabel("Or paste CSV text")
    .fill(
      ["client,project,domain", "Roof Pros,Main site,roofpros.example", "Tile Hub,,"].join("\n"),
    );
  await page.getByRole("button", { name: "Import" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added 2 clients and 1 projects." }),
  ).toBeVisible();
  await page.goto(`/app/${slug}/clients`);
  await expect(page.getByText("Roof Pros")).toBeVisible();
  await expect(page.getByText("Tile Hub")).toBeVisible();

  // Money settings and a retainer.
  await page.goto(`/app/${slug}/profitability`);
  await waitForHydration(page, "form");
  await expect(page.getByRole("heading", { name: "Profitability" })).toBeVisible();
  await page.getByLabel("Cost of one team hour (USD)").fill("50");
  await page.getByRole("button", { name: "Save money settings" }).click();
  await expect(page.getByText("Money settings saved.")).toBeVisible();

  await page.getByLabel("Monthly retainer for Roof Pros").fill("1200");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Retainer saved for Roof Pros.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Monthly retainer for Roof Pros")).toHaveValue("1200");
  const table = page.getByRole("table", { name: "Estimated profit per client" });
  await expect(table.getByRole("row", { name: /Roof Pros/ })).toContainText("1,200.00 USD");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
