import { expect, test } from "@playwright/test";
import { seedRankings } from "./db";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("a client page and a project show progress since tracking started", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("progress"), "Pia Progress");
  const slug = await createAgencyInUi(page, `Progress ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Blue Bakery");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { name: "Blue Bakery" })).toBeVisible();
  const clientUrl = page.url();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Bakery site");
  await page.getByLabel("Website domain").fill("bluebakery.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Bakery site" })
    .click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectUrl = page.url().split("?")[0]!;
  const projectId = /\/projects\/([^/?]+)/.exec(projectUrl)![1]!;

  // Before any check there is nothing to compare.
  await page.goto(clientUrl);
  await expect(page.getByText("No keywords have been checked yet.")).toBeVisible();

  // Two up, one down, and page one grows from 1 to 2 keywords.
  await seedRankings(slug, projectId, [
    ["fresh bread", 30, 4],
    ["cake shop", 8, 20],
    ["birthday cakes", null, 6],
  ]);

  await page.goto(clientUrl);
  const card = page.getByRole("region", { name: "Progress since tracking started" });
  await expect(
    card.getByRole("heading", { name: "Rankings are better than at the start" }),
  ).toBeVisible();
  await expect(card.getByText("Keywords up")).toBeVisible();
  await expect(card.locator("dd").first()).toHaveText("2");
  await expect(card.getByText("1 to 2")).toBeVisible();

  await page.goto(projectUrl);
  await expect(
    page.getByRole("heading", { name: "Rankings are better than at the start" }),
  ).toBeVisible();
  await page.goto(`${projectUrl}/rankings`);
  await expect(
    page.getByRole("heading", { name: "Rankings are better than at the start" }),
  ).toBeVisible();
});
