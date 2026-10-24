import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("add 10 keywords, run a check, see the table and the chart", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("ranks"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Rank Test ${Date.now()}`);

  // A client and a project.
  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Bright Dental");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Main website");
  await page.getByLabel("Website domain").fill("brightdental.com");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Main website" })
    .click();

  // Empty project overview.
  await expect(page.getByRole("heading", { name: "Main website", level: 1 })).toBeVisible();
  await expect(page.getByText("No keywords yet")).toBeVisible();

  // Add 10 keywords from a pasted list.
  await page.getByRole("link", { name: "Add keywords" }).click();
  await expect(page).toHaveURL(/\/rankings$/);
  await page.locator("summary", { hasText: "Add keywords" }).click();
  const keywords = [
    "dentist near me",
    "teeth whitening cost",
    "emergency dentist",
    "dental implants",
    "invisalign price",
    "root canal",
    "dental checkup",
    "kids dentist",
    "cosmetic dentistry",
    "wisdom tooth removal",
  ];
  await page.getByLabel("Keywords (one per line)").fill(keywords.join("\n") + "\nDentist Near Me");
  await page.getByLabel("Tags (optional, separated by commas)").fill("local, services");
  await page.getByRole("button", { name: "Add keywords" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added 10 keywords (1 listed twice)." }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "Keyword rankings" });
  await expect(table.getByRole("row")).toHaveCount(11); // header + 10
  await expect(table.getByText("Not checked")).toHaveCount(10);

  // Run a check. The worker does the work and the page updates when it is done.
  await page.getByRole("button", { name: "Check all now" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Rankings are up to date." }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(table.getByText("Not checked")).toHaveCount(0);
  const firstRowPosition = await table.getByRole("row").nth(1).getByRole("cell").nth(2).innerText();
  expect(firstRowPosition).toMatch(/^(\d+|100\+)$/);

  // Overview now has numbers.
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByText("Average position")).toBeVisible();
  await expect(page.getByText("Where the keywords rank")).toBeVisible();
  await expect(page.getByText(/^\d+ of 10$/)).toBeVisible();

  // Fake history makes the chart and the change columns interesting.
  execSync(`pnpm mock:backfill --days 30 --agency ${slug}`, { stdio: "pipe" });
  await page.getByRole("link", { name: "Rankings", exact: true }).click();
  await page.getByRole("link", { name: "dentist near me" }).click();
  await expect(page.getByRole("heading", { name: "dentist near me", level: 2 })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Position history for dentist near me: 31 days/ }),
  ).toBeVisible();
  await expect(page.locator(".recharts-line")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Top 10 search results" }).getByRole("row"),
  ).toHaveCount(11);

  // Filtering, sorting and CSV.
  await page.goto(`/app/${slug}/projects/${await projectId(page)}/rankings`);
  await page.getByLabel("Search keywords").fill("dentist");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(table.getByRole("row")).toHaveCount(5); // header + 4 keywords that contain "dentist"
  await page.getByRole("link", { name: "Position", exact: true }).click();
  await expect(page).toHaveURL(/sort=position/);
  const csv = await page.request.get(
    page.url().replace(/\/rankings\?.*/, "/rankings/export?q=dentist"),
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body.split("\r\n")[0]).toBe(
    "Keyword,Position,Change (1 day),Change (7 days),Change (30 days),Best position,Ranking URL,SERP features,Tags,Last checked",
  );
  expect(body).toContain("dentist near me");

  // Accessibility on the rankings page.
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});

async function projectId(page: import("@playwright/test").Page): Promise<string> {
  const match = /\/projects\/([^/?]+)/.exec(page.url());
  if (!match) throw new Error(`No project id in ${page.url()}`);
  return match[1]!;
}
