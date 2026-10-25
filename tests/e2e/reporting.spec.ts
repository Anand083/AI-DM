import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("goals, timeline notes, a report template and the performance page", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("reporting"), "Rita Reporting");
  const slug = await createAgencyInUi(page, `Reporting Agency ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Client Gamma");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Gamma");
  await page.getByLabel("Website domain").fill("gamma.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("table", { name: "Projects" }).getByRole("link", { name: "Gamma" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectUrl = page.url().split("?")[0]!;

  // Goals
  await page.goto(`${projectUrl}/goals`);
  await expect(page.getByText("No goals yet.")).toBeVisible();
  await page.getByLabel("Target", { exact: true }).fill("-3");
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByText("Enter zero or more.")).toBeVisible();
  await page.getByLabel("Target", { exact: true }).fill("20");
  await page.getByLabel("Due date (optional)").fill("2030-12-31");
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByRole("list", { name: "Goals" })).toContainText("Keywords in the top 10");
  await expect(page.getByRole("list", { name: "Goals" })).toContainText("target 20");
  await expect(page.getByText("Estimates need at least 5.")).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: /Keywords in the top 10 progress/ }),
  ).toBeVisible();

  // Timeline notes
  await page.getByLabel("Date", { exact: true }).fill("2026-03-12");
  await page.getByLabel("What happened").fill("a");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Write at least 3 characters.")).toBeVisible();
  await page.getByLabel("What happened").fill("March core update");
  await page.getByLabel("Type", { exact: true }).selectOption({ label: "Google update" });
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("list", { name: "Timeline notes" })).toContainText(
    "March core update",
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // A template made in the report builder is offered next time.
  await page.goto(`/app/${slug}/reports/new`);
  await page.getByLabel("Top movers").uncheck();
  await page.getByLabel("Goals", { exact: true }).check();
  await page.getByLabel("Timeline notes", { exact: true }).check();
  await page.getByLabel("Save these sections as a template").fill("Monthly with goals");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText('Saved the template "Monthly with goals".')).toBeVisible();
  await page.reload();
  await page.getByLabel("Start from a template").selectOption({ label: "Monthly with goals" });
  await expect(page.getByLabel("Goals", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Top movers")).not.toBeChecked();

  // Performance page
  await page.goto(`/app/${slug}/performance`);
  const table = page.getByRole("table", { name: "Project performance" });
  await expect(table).toContainText("Gamma");
  await expect(table).toContainText("Client Gamma");
  await expect(table).toContainText("0 of 1");
  const download = await page.request.get(`/app/${slug}/performance/export`);
  expect(download.status()).toBe(200);
  expect(await download.text()).toContain("Client Gamma,Gamma");
  const axe2 = await new AxeBuilder({ page }).analyze();
  expect(axe2.violations).toEqual([]);
});
