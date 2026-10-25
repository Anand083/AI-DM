import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("add questions, run an AI check, read the results", async ({ page }) => {
  test.setTimeout(240_000);
  await signUpAndVerify(page, newEmail("ai"), "Ada AI");
  const slug = await createAgencyInUi(page, `AI Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Smile Clinic");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Clinic site");
  await page.getByLabel("Website domain").fill("smileclinic.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Clinic site" })
    .click();

  await page.getByRole("link", { name: "AI visibility", exact: true }).click();
  await expect(page.getByText("No AI results yet")).toBeVisible();
  await expect(page.getByLabel("Brand name to look for")).toHaveValue("Smile Clinic");
  // No check can start without a question.
  await expect(page.getByRole("button", { name: "Run first check" })).toHaveCount(0);

  // Questions: bad, good, duplicate.
  await page.getByLabel("New question").fill("hi");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Write the question in at least 5 characters.")).toBeVisible();
  for (const q of ["best dentist in Austin", "teeth whitening near me"]) {
    await page.getByLabel("New question").fill(q);
    await page.getByRole("button", { name: "Add question" }).click();
    await expect(page.getByRole("list", { name: "Questions" })).toContainText(q);
  }
  await page.getByLabel("New question").fill("best dentist in Austin");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("This question is already on the list.")).toBeVisible();

  // Settings: pick only two engines.
  await page.getByLabel("Brand name to look for").fill("Smile Clinic Austin");
  await page.getByLabel("Perplexity").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();

  // The worker asks the engines.
  await page.getByRole("button", { name: "Run first check" }).click();
  await expect(page.getByText("Brand mentioned")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Already checked today.")).toBeVisible();
  const engines = page.getByRole("table", { name: "By AI engine" });
  await expect(engines).toContainText("ChatGPT");
  await expect(engines).toContainText("Gemini");
  await expect(engines).not.toContainText("Perplexity");
  // 2 questions x 2 engines = 4 answers.
  await expect(page.getByRole("table", { name: "Latest answers" }).getByRole("row")).toHaveCount(5);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Remove a question.
  await page.getByRole("button", { name: "Remove question: teeth whitening near me" }).click();
  await expect(page.getByRole("list", { name: "Questions" })).not.toContainText(
    "teeth whitening near me",
  );
});
