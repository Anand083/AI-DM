import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("connect Google, choose a site and a property, read the numbers", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("google"), "Gina Google");
  const slug = await createAgencyInUi(page, `Google Test ${Date.now()}`);

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
  const projectUrl = page.url();
  const projectId = projectUrl.split("/").pop()!;

  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page.getByText("This copy uses sample Google data.")).toBeVisible();
  await expect(
    page
      .getByText("Google is not connected")
      .or(page.getByRole("link", { name: "Connect Google" }))
      .first(),
  ).toBeVisible();

  // Safety checks on the two OAuth routes.
  const noRedirect = { maxRedirects: 0 } as const;
  expect(
    (
      await page.request.get(
        `/api/google/start?agency=nobody-here&project=${projectId}`,
        noRedirect,
      )
    ).status(),
  ).toBe(404);
  expect((await page.request.get("/api/google/start", noRedirect)).status()).toBe(400);
  expect(
    (
      await page.request.get("/api/google/callback?code=mock-code&state=forged.value", noRedirect)
    ).status(),
  ).toBe(400);

  // The real flow: our start route, the (mock) Google page, our callback.
  await page.getByRole("link", { name: "Connect Google" }).click();
  await expect(page).toHaveURL(/\/analytics\?google=connected/);
  await expect(page.getByText("Google is connected. Choose what to read below.")).toBeVisible();
  await expect(page.getByText(/Connected as owner@example\.com/)).toBeVisible();

  // The same code and state cannot be used again without the cookie of the first visit.
  const replay = await page.request.get(
    "/api/google/callback?code=mock-code&state=" + encodeURIComponent("x.y"),
    noRedirect,
  );
  expect(replay.status()).toBe(400);

  // Choose what to read.
  await page.getByLabel("Search Console site").selectOption("sc-domain:example.com");
  await page.getByLabel("Google Analytics 4 property").selectOption("123456789");
  await page.getByRole("button", { name: "Save choice" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved. We are reading the numbers now." }),
  ).toBeVisible();

  // The worker reads the numbers; reload until they are there.
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Google Search", exact: true })).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByText("Clicks", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Impressions", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Analytics", exact: true })).toBeVisible();
  await expect(page.getByText("Sessions", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Search by day" }).getByRole("row")).toHaveCount(15);
  await expect(page.getByText("Already updated today.")).toBeVisible();

  // Breakdowns, landing pages and the combined day table.
  await expect(page.getByRole("table", { name: "Search by queries" })).toContainText("seo agency");
  await page
    .getByRole("navigation", { name: "Search breakdown" })
    .getByRole("link", { name: "Devices" })
    .click();
  await expect(page).toHaveURL(/by=device/);
  await expect(page.getByRole("table", { name: "Search by devices" })).toContainText("Phone");
  await page
    .getByRole("navigation", { name: "Search breakdown" })
    .getByRole("link", { name: "Countries" })
    .click();
  await expect(page.getByRole("table", { name: "Search by countries" })).toContainText(
    "United States",
  );
  await expect(page.getByRole("table", { name: "Landing pages" })).toContainText("/pricing");
  await expect(page.getByRole("table", { name: "Combined by day" }).getByRole("row")).toHaveCount(
    29,
  );

  // Ask Google about one page (a page from another website is refused).
  await page.getByLabel("Page address").fill("https://other.example/page");
  await page.getByRole("button", { name: "Check with Google" }).click();
  await expect(
    page.getByText("Use an address on this website, starting with https://."),
  ).toBeVisible();
  await page.getByLabel("Page address").fill("https://bluebakery.example/menu");
  await page.getByRole("button", { name: "Check with Google" }).click();
  const checks = page.getByRole("list", { name: "Google page checks" });
  await expect(checks).toContainText("https://bluebakery.example/menu", { timeout: 60_000 });
  await expect(checks).toContainText(/On Google|Not on Google|Left out of Google on purpose/);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Disconnect.
  await page.getByRole("button", { name: "Disconnect Google" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("link", { name: "Connect Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Search", exact: true })).toHaveCount(0);
});
