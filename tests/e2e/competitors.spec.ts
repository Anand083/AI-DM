import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("add a competitor, compare rankings, find keyword gaps and track one", async ({ page }) => {
  test.setTimeout(240_000);
  await signUpAndVerify(page, newEmail("competitors"), "Cora Competitor");
  const slug = await createAgencyInUi(page, `Competitor Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Green Cafe");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Cafe site");
  await page.getByLabel("Website domain").fill("greencafe.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Cafe site" })
    .click();

  // Keywords and one check, so there are saved top 10 results to compare with.
  await page.getByRole("link", { name: "Add keywords" }).click();
  await page.locator("summary", { hasText: "Add keywords" }).click();
  await page
    .getByLabel("Keywords (one per line)")
    .fill("coffee shop\nbest espresso\nbrunch near me");
  await page.getByRole("button", { name: "Add keywords" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 3 keywords." })).toBeVisible();
  await page.getByRole("button", { name: "Check all now" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Rankings are up to date." }),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "Competitors", exact: true }).click();
  await expect(page.getByText("No competitors yet.")).toBeVisible();

  // Bad and good input.
  await page.getByLabel("Competitor website").fill("greencafe.example");
  await page.getByRole("button", { name: "Add competitor" }).click();
  await expect(page.getByText("This is the website of the project itself.")).toBeVisible();
  await page.getByLabel("Competitor website").fill("https://www.topratedpros.example/page");
  await page.getByRole("button", { name: "Add competitor" }).click();
  const chips = page.getByRole("list", { name: "Competitors" });
  await expect(chips.getByText("topratedpros.example")).toBeVisible();
  await page.getByLabel("Competitor website").fill("topratedpros.example");
  await page.getByRole("button", { name: "Add competitor" }).click();
  await expect(page.getByText("This competitor is already on the list.")).toBeVisible();

  // The comparison needs no provider call, so it is there at once.
  await expect(page.getByRole("heading", { name: "Ranking comparison" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Ranking comparison" })).toBeVisible();
  await expect(page.getByText(/In the top 10\. Ahead of you on \d+/)).toBeVisible();

  // The worker finds the keyword gap.
  await expect(page.getByText("No keyword gap yet")).toBeVisible();
  await page.getByRole("button", { name: "Find keyword gaps" }).click();
  const gap = page.getByRole("table", { name: "Keyword gap" });
  await expect(gap).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Already refreshed today.")).toBeVisible();

  // Add one gap keyword to the rank tracker.
  const firstKeyword = (
    await gap.getByRole("row").nth(1).getByRole("cell").nth(1).innerText()
  ).trim();
  await gap.getByRole("row").nth(1).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Add to rank tracker (1)" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added 1 keyword to the rank tracker" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Rankings", exact: true }).click();
  await expect(page.getByRole("table", { name: "Keyword rankings" })).toContainText(firstKeyword);

  // Accessibility.
  await page.getByRole("link", { name: "Competitors", exact: true }).click();
  await expect(page.getByRole("table", { name: "Keyword gap" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Remove the competitor.
  await page.getByRole("button", { name: "Remove topratedpros.example" }).click();
  await expect(page.getByText("No competitors yet.")).toBeVisible();
});
