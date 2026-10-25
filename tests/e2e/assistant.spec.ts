import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify, waitForHydration } from "./helpers";

test("ask the assistant, read the evidence, approve one suggestion", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("assistant"), "Ava Assistant");
  const slug = await createAgencyInUi(page, `Assistant ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Pet Shop");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Pet site");
  await page.getByLabel("Website domain").fill("petshop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Pet site" })
    .click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectUrl = page.url().split("?")[0]!;

  // With no data the assistant says so and suggests nothing.
  await page.goto(`${projectUrl}/assistant`);
  await expect(page.getByText("No questions yet.")).toBeVisible();
  await waitForHydration(page, "form");
  await page.getByLabel("Ask about this website").fill("hi");
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  await page.getByLabel("Ask about this website").fill("What should I work on first?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const convo = page.getByRole("list", { name: "Conversation" });
  await expect(convo).toContainText("There is not enough data", { timeout: 60_000 });
  await expect(convo).toContainText("Confidence: low");
  await expect(convo).toContainText("Sample answer (rule based)");
  await expect(convo).toContainText("No data was found to back this up.");

  // After an audit there is something to say, with evidence and suggestions.
  await page.goto(`${projectUrl}/audit`);
  await page.getByRole("button", { name: "Run first audit" }).click();
  await expect(page.getByRole("heading", { name: "Audit results" })).toBeVisible({
    timeout: 90_000,
  });
  await page.goto(`${projectUrl}/assistant`);
  await waitForHydration(page, "form");
  await page.getByLabel("Ask about this website").fill("What is wrong with the site audit?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const evidence = page.getByRole("list", { name: "Evidence" });
  await expect(evidence).toBeVisible({ timeout: 60_000 });
  await expect(evidence).toContainText("Site audit:");
  await expect(
    page.getByText("Suggested next steps (nothing happens until you approve)"),
  ).toBeVisible();

  // Nothing was created until we approve.
  await page.goto(`/app/${slug}/tasks`);
  await expect(page.getByText("Fix: ")).toHaveCount(0);
  await page.goto(`${projectUrl}/assistant`);
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Task created." })).toBeVisible();
  await expect(page.getByText("Approved. Task created.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  await expect(page.getByText("Dismissed.")).toBeVisible();
  await page.goto(`/app/${slug}/tasks`);
  await expect(page.getByRole("link", { name: /^Fix: / }).first()).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    axe.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});
