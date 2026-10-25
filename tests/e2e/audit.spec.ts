import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("start an audit, wait, and read the score and the issues", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("audit"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Audit Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Green Garden");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Shop");
  await page.getByLabel("Website domain").fill("greengarden.example");
  await page.getByLabel("Run a site audit automatically every month").check();
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("table", { name: "Projects" }).getByRole("link", { name: "Shop" }).click();

  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(page.getByText("No audits yet")).toBeVisible();

  // Crawl settings.
  await page.getByText("Crawl settings", { exact: true }).click();
  await page.getByLabel("Skip these paths (one per line)").fill("/cart\n/account");
  await page.getByRole("button", { name: "Save crawl settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Crawl settings saved." })).toBeVisible();
  await page.getByRole("button", { name: "Run first audit" }).click();

  // The worker runs it; the page shows progress and then the result.
  await expect(page.getByRole("heading", { name: "Audit results" })).toBeVisible({
    timeout: 90_000,
  });
  const score = page.getByLabel(/^Health score \d+ out of 100$/);
  await expect(score).toBeVisible();
  const value = Number((await score.innerText()).trim());
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(100);
  await expect(page.getByText(/\d+ pages checked/)).toBeVisible();
  await expect(page.getByText("Critical", { exact: true }).first()).toBeVisible();

  // Open an issue and read how to fix it.
  const first = page.locator("details").first();
  await first.locator("summary").click();
  await expect(first.getByText("Why it matters")).toBeVisible();
  await expect(first.getByText("How to fix it")).toBeVisible();
  await expect(first.getByText("Pages affected")).toBeVisible();

  // robots.txt and sitemap findings.
  await expect(page.getByRole("heading", { name: "robots.txt and sitemap" })).toBeVisible();

  // Ignore a whole issue type, then put it back (the issue is still open from above).
  await first.getByRole("button", { name: "Ignore" }).click();
  await expect(first.getByText(/Ignored: \d+ pages?\./)).toBeVisible();
  await expect(first.locator("summary")).toContainText("ignored");
  await first.getByRole("button", { name: "Put back on the list" }).click();
  await expect(first.getByText(/Put back: \d+ pages?\./)).toBeVisible();

  // Pages tab, with Core Web Vitals.
  await page.getByRole("link", { name: "Pages", exact: true }).click();
  await expect(page.getByRole("table", { name: "Pages checked" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "LCP" })).toBeVisible();

  // Accessibility.
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // The audit list shows it, and a second audit can be started.
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(page.getByRole("table", { name: "Audits" }).getByText("Done")).toBeVisible();
  await page.getByRole("button", { name: "Run new audit" }).click();
  await expect(page.getByRole("heading", { name: /Audit (results|in progress)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit results" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/Compared with the audit on/)).toBeVisible();
});
