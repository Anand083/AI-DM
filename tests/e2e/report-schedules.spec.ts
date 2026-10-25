import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("create, pause, resume and delete a report schedule", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("sched"), "Sam Scheduler");
  const slug = await createAgencyInUi(page, `Schedule Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Green Garden");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Shop");
  await page.getByLabel("Website domain").fill("shop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();

  await page.goto(`/app/${slug}/reports`);
  await page.getByRole("link", { name: "Schedules" }).click();
  await expect(page.getByRole("heading", { name: "Report schedules" })).toBeVisible();
  await expect(page.getByText("No schedules yet")).toBeVisible();

  // Bad input gives a clear message.
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Add at least one email address.")).toBeVisible();

  await page.getByLabel("How often").selectOption("WEEKLY");
  await page.getByLabel("Day", { exact: true }).selectOption({ label: "Friday" });
  await page.getByLabel(/^Time/).selectOption("9");
  await page.getByLabel("Send to (email addresses)").fill("client@example.com, boss@example.com");
  await page.getByRole("button", { name: "Save schedule" }).click();

  const table = page.getByRole("table", { name: "Schedules" });
  await expect(table.getByText("Every Friday at 09:00")).toBeVisible();
  await expect(table.getByText("client@example.com, boss@example.com")).toBeVisible();
  await expect(table.getByText("On", { exact: true })).toBeVisible();
  // The project now has a schedule, so the form has nothing left to add.
  await expect(page.getByText("Every project already has a schedule")).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  await table.getByRole("button", { name: /Pause/ }).click();
  await expect(table.getByText("Paused")).toBeVisible();
  await table.getByRole("button", { name: /Resume/ }).click();
  await expect(table.getByText("On", { exact: true })).toBeVisible();

  await table.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No schedules yet")).toBeVisible();
});
