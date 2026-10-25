import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("add locations, check local positions and listing details", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("loc"), "Lena Local");
  const slug = await createAgencyInUi(page, `Locations ${Date.now()}`);

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
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectUrl = page.url().split("?")[0]!;

  // Local keywords first.
  await page.goto(`${projectUrl}/rankings`);
  await page.locator("summary", { hasText: "Add keywords" }).click();
  await page.getByLabel("Keywords (one per line)").fill("dentist near me\nteeth whitening");
  await page.getByLabel("Tags (optional, separated by commas)").fill("local");
  await page.getByRole("button", { name: "Add keywords" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 2 keywords." })).toBeVisible();

  // Locations: a bad phone number, then two good places.
  await page.goto(`${projectUrl}/locations`);
  await expect(page.getByText("No locations yet.")).toBeVisible();
  await page.locator("#loc-new-name").fill("Downtown");
  await page.locator("#loc-new-city").fill("Austin");
  await page.locator("#loc-new-address").fill("12 North Main Street, Austin");
  await page.locator("#loc-new-phone").fill("call us");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await expect(page.getByText("Use only numbers and + ( ) - . in the phone number.")).toBeVisible();
  await page.locator("#loc-new-phone").fill("(512) 555-0134");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await expect(page.getByRole("list", { name: "Locations" })).toContainText("Downtown");

  await page.locator("#loc-new-name").fill("Airport");
  await page.locator("#loc-new-city").fill("Dallas");
  await page.locator("#loc-new-address").fill("500 Terminal Road, Dallas");
  await page.locator("#loc-new-phone").fill("214-555-0100");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await expect(page.getByRole("list", { name: "Locations" })).toContainText("Airport");

  // The worker checks local positions and listings; both are labelled as sample data.
  await page.getByRole("button", { name: "Check local positions" }).click();
  const positions = page.getByRole("table", { name: "Local positions" });
  await expect(positions).toBeVisible({ timeout: 90_000 });
  await expect(positions).toContainText("dentist near me");
  await expect(positions.getByRole("columnheader", { name: "Airport" })).toBeVisible();
  await expect(page.getByText("This is sample data, not real Google results.")).toBeVisible();

  await page.getByRole("button", { name: "Check listings" }).click();
  await expect(page.getByRole("table", { name: "Listings for Downtown" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("table", { name: "Listings for Downtown" })).toContainText(
    "Google Business Profile",
  );
  await expect(page.getByText("This is sample data, not real directory results.")).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    axe.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});
