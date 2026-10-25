import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("import keywords, edit tags in bulk, read insights and the keyword page", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("kwi"), "Kira Keywords");
  const slug = await createAgencyInUi(page, `Keyword Insights ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Shoe Shop");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Shop");
  await page.getByLabel("Website domain").fill("shoeshop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("table", { name: "Projects" }).getByRole("link", { name: "Shop" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectUrl = page.url().split("?")[0]!;

  // Import from pasted CSV; the bad line is reported.
  await page.goto(`${projectUrl}/rankings`);
  await page.locator("summary", { hasText: "Import from CSV" }).click();
  await page
    .getByLabel("Or paste CSV text")
    .fill(
      "keyword,tags,url\nrunning shoes,brand,https://shoeshop.example/shoes\nbest running shoes,,\nbuy running shoes,,\ntrail shoes,,notaurl\ndentist near me,,\n",
    );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Added 4, updated 0.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Import problems" })).toContainText(
    "not a full web address",
  );

  // Select two keywords and give them a tag and a target page.
  const table = page.getByRole("table", { name: "Keyword rankings" });
  await expect(table.getByRole("row")).toHaveCount(5);
  await page.getByLabel("Select best running shoes").check();
  await page.getByLabel("Select buy running shoes").check();
  await page.getByRole("button", { name: "Edit selected" }).click();
  await page.getByLabel("Add tags", { exact: true }).fill("shoes");
  await page.getByLabel("Set target page").fill("https://shoeshop.example/shoes");
  await page.getByRole("button", { name: "Apply to 2 keywords" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Updated 2 keywords." })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "best running shoes" })).toContainText(
    "shoes",
  );

  // Insights: clusters and intent first, then volume from the worker.
  await page.getByRole("link", { name: "Keyword insights" }).click();
  await expect(page.getByRole("heading", { name: "Keyword insights" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Keyword clusters" })).toContainText("running shoe");
  await expect(page.getByRole("list", { name: "Search intent" })).toContainText(
    "Looking nearby: 1",
  );
  await expect(page.getByRole("table", { name: "Keyword to page map" })).toContainText(
    "https://shoeshop.example/shoes",
  );
  await page.getByRole("button", { name: "Get volume and Bing positions" }).click();
  await expect(page.getByText("Already updated today.")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Bing checked")).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    axe.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // The keyword page shows the new numbers.
  await page.goto(`${projectUrl}/rankings`);
  await page.getByRole("link", { name: "running shoes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Search numbers" })).toBeVisible();
  await expect(page.getByText("Searches a month", { exact: true })).toBeVisible();
  await expect(page.getByText("What searchers want", { exact: true })).toBeVisible();
});
