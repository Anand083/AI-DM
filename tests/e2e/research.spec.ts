import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("search, filter, save to a list and add 3 keywords to the rank tracker", async ({ page }) => {
  test.setTimeout(150_000);
  await signUpAndVerify(page, newEmail("research"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Research Test ${Date.now()}`);

  // A project to track keywords in.
  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Bright Dental");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Main website");
  await page.getByLabel("Website domain").fill("brightdental.com");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();

  // Open the tool from the menu and search.
  await page
    .getByRole("navigation", { name: "Main" })
    .first()
    .getByRole("link", { name: "Keyword research" })
    .click();
  await expect(page.getByRole("heading", { name: "Keyword research", level: 1 })).toBeVisible();
  await expect(page.getByText("Start with a topic")).toBeVisible();
  await page.getByLabel("Seed keyword").fill("dental implants");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  const table = page.getByRole("table", { name: "Keyword ideas" });
  await expect(table).toBeVisible();
  await expect(page.getByText(/\d+ ideas for “dental implants”/)).toBeVisible();
  await expect(table.getByRole("cell", { name: "dental implants", exact: true })).toBeVisible();
  await expect(table.getByRole("img", { name: /Searches over 12 months/ }).first()).toBeVisible();

  // Filter by intent: every row says "Buy".
  await page.getByText("Filter and sort results").click();
  await page.getByLabel("Intent").selectOption("transactional");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/\d+ ideas? for “dental implants”/)).toBeVisible();
  const rows = table.getByRole("row");
  const count = await rows.count();
  expect(count).toBeGreaterThan(2);
  for (let i = 1; i < count; i++) {
    await expect(rows.nth(i).getByRole("cell").nth(5)).toHaveText("Buy");
  }

  // Select 3 and add them to the rank tracker.
  const names: string[] = [];
  for (let i = 1; i <= 3; i++) {
    names.push(await rows.nth(i).getByRole("cell").nth(1).innerText());
    await rows.nth(i).getByRole("checkbox").check();
  }
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByRole("button", { name: "Add to rank tracker" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Added 3 keywords to Main website (brightdental.com)." }),
  ).toBeVisible();

  // The same 3 can be saved to a new list.
  for (let i = 1; i <= 3; i++) await rows.nth(i).getByRole("checkbox").check();
  await page.getByLabel("New list name").fill("Dentist ideas");
  await page.getByRole("button", { name: "Save to list" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved 3 keywords to your list." }),
  ).toBeVisible();

  // Searching again is answered from saved results.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/saved results, this search was free/)).toBeVisible();

  // They are in the project's rankings, tagged "research".
  await page.goto(`/app/${slug}/projects`);
  await page.getByRole("link", { name: "Main website" }).click();
  await page.getByRole("link", { name: "Rankings", exact: true }).click();
  const rankings = page.getByRole("table", { name: "Keyword rankings" });
  await expect(rankings.getByRole("row")).toHaveCount(4);
  for (const name of names)
    await expect(rankings.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(rankings.getByText("research").first()).toBeVisible();

  // The saved list.
  await page.goto(`/app/${slug}/research/lists`);
  await page.getByRole("link", { name: "Dentist ideas" }).click();
  await expect(page.getByRole("heading", { name: "Dentist ideas", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Keywords in this list" }).getByRole("row"),
  ).toHaveCount(4);
  const csv = await page.request.get(`${page.url()}/export`);
  expect(csv.status()).toBe(200);
  expect((await csv.text()).split("\r\n")[0]).toBe(
    "Keyword,Searches a month,Cost per click,Difficulty,Intent",
  );

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});
