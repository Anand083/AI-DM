import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("read the content list after an audit, log an update, download the CSV", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("content"), "Cora Content");
  const slug = await createAgencyInUi(page, `Content ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Garden Shop");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Garden site");
  await page.getByLabel("Website domain").fill("gardenshop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Garden site" })
    .click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectUrl = page.url().split("?")[0]!;

  // Without an audit there is nothing to list.
  await page.goto(`${projectUrl}/content`);
  await expect(page.getByText("No audit yet")).toBeVisible();

  // Run an audit, then the content list appears.
  await page.goto(`${projectUrl}/audit`);
  await page.getByRole("button", { name: "Run first audit" }).click();
  await expect(page.getByRole("heading", { name: "Audit results" })).toBeVisible({
    timeout: 90_000,
  });
  await page.goto(`${projectUrl}/content`);
  await expect(page.getByRole("heading", { name: "Content", exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Content inventory" });
  await expect(table).toBeVisible();
  await expect(table).toContainText("/pricing");
  await expect(page.getByRole("heading", { name: "Pages losing traffic" })).toBeVisible();
  await expect(
    page.getByText("No page is losing traffic, or Google is not connected yet."),
  ).toBeVisible();

  // Filters and sorting are links.
  await page
    .getByRole("navigation", { name: "Show pages" })
    .getByRole("link", { name: "Thin content" })
    .click();
  await expect(page).toHaveURL(/show=thin/);
  await page
    .getByRole("navigation", { name: "Show pages" })
    .getByRole("link", { name: "All pages" })
    .click();

  // Log an update: a page of another website is refused, a good one is kept.
  await page.getByLabel("Page address").fill("https://other.example/page");
  await page.getByRole("button", { name: "Log update" }).click();
  await expect(
    page.getByText("Use an address on this website, starting with https://."),
  ).toBeVisible();
  await page.getByLabel("Page address").fill("https://gardenshop.example/pricing");
  await page.getByLabel("What changed (optional)").fill("New price table");
  await page.getByRole("button", { name: "Log update" }).click();
  const logged = page.getByRole("list", { name: "Logged updates" });
  await expect(logged).toContainText("/pricing");
  await expect(logged).toContainText("Too early to tell. Check back in 14 days.");

  // CSV download.
  const csv = await page.request.get(`${projectUrl}/content/export`);
  expect(csv.status()).toBe(200);
  const body = await csv.text();
  expect(body.split("\r\n")[0]).toBe(
    "Page,Title,Status,Words,Problems,Internal links,Last updated,Clicks (28 days),Clicks (28 days before),Keywords,Needs attention",
  );
  expect(body).toContain("/pricing");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    axe.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});
