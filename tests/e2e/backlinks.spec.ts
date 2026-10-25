import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("check backlinks, filter the list, download the CSV", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("backlinks"), "Bea Backlinks");
  const slug = await createAgencyInUi(page, `Backlinks Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Blue Bakery");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Bakery site");
  await page.getByLabel("Website domain").fill("bluebakery.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Bakery site" })
    .click();

  await page.getByRole("link", { name: "Backlinks", exact: true }).click();
  await expect(page.getByText("No backlink data yet")).toBeVisible();
  await page.getByRole("button", { name: "Check backlinks" }).click();

  // The worker does the check; the page refreshes itself.
  await expect(page.getByText("Total backlinks")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Referring domains")).toBeVisible();
  await expect(page.getByText("Domain rating")).toBeVisible();
  await expect(page.getByText("Shown after the second check").first()).toBeVisible();
  const table = page.getByRole("table", { name: "Backlinks" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).not.toHaveCount(1);
  await expect(page.getByText("Already checked today.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again" })).toBeDisabled();

  // Filters keep working, and an empty one says so in plain words.
  await page.getByRole("link", { name: "New", exact: true }).click();
  await expect(page.getByText("No new links")).toBeVisible();
  await page.getByRole("link", { name: "Lost", exact: true }).click();
  await expect(page).toHaveURL(/filter=lost/);
  await page.getByRole("link", { name: "Active", exact: true }).click();

  // CSV with the right header.
  const href = await page.getByRole("link", { name: "Download CSV" }).getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.text()).split("\r\n")[0]).toBe(
    "Source URL,Source domain,Target URL,Anchor text,Type,Source rating,First seen,Last seen,Lost on,Suspicious,Why suspicious",
  );

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // A phone-sized screen scrolls the table inside its box, not the whole page.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
