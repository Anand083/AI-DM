import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expireShareLink, seedRankings } from "./db";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("build a report, download it, share it, and see the link stop working", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("report"), "Rita Reporter");
  const agencyName = `Report Test ${Date.now()}`;
  const slug = await createAgencyInUi(page, agencyName);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Green Garden");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Shop");
  await page.getByLabel("Website domain").fill("shop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("table", { name: "Projects" }).getByRole("link", { name: "Shop" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const match = /\/projects\/([^/?]+)/.exec(page.url());
  if (!match) throw new Error(`No project id in ${page.url()}`);
  const projectId = match[1]!;
  await seedRankings(slug, projectId, [
    ["garden chairs", 14, 4],
    ["garden tables", 6, 9],
    ["garden lamps", null, 18],
  ]);

  // Empty list first.
  await page.goto(`/app/${slug}/reports`);
  await expect(page.getByText("No reports yet")).toBeVisible();
  await page.getByRole("link", { name: "New report" }).first().click();

  // Builder.
  await page.getByLabel("Project").selectOption({ label: "Shop (Green Garden)" });
  await page.getByLabel("Period").selectOption("last30");
  await page.getByLabel("Title (optional)").fill("Monthly update");
  await page.getByRole("checkbox", { name: "Notes", exact: true }).check();
  await page.getByLabel("Notes for your client").fill("Thank you for a good month.");
  await page.getByRole("button", { name: "Create report" }).click();

  // The worker builds it. The page updates by itself.
  await expect(page.getByRole("heading", { name: "Monthly update", level: 1 })).toBeVisible();
  const download = page.getByRole("link", { name: "Download PDF" }).first();
  await expect(download).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("garden chairs").first()).toBeVisible();
  await expect(page.getByText("Thank you for a good month.")).toBeVisible();

  // Download the PDF.
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toMatch(/^monthly-update-\d{4}-\d{2}-\d{2}\.pdf$/);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1500);

  // The list shows it as ready.
  await page.goto(`/app/${slug}/reports`);
  const list = page.getByRole("table", { name: "Reports" });
  await expect(list.getByText("Ready")).toBeVisible();

  // Accessibility of the report page.
  await list.getByRole("link", { name: "Monthly update", exact: true }).click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Share link.
  await page.getByRole("button", { name: "Create link" }).click();
  const linkBox = page.getByLabel("Public link");
  await expect(linkBox).toBeVisible();
  const link = await linkBox.inputValue();
  expect(link).toMatch(/\/r\/[A-Za-z0-9_-]{16,}$/);

  // Someone who is not signed in can open it.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const response = await guestPage.goto(link);
  expect(response?.status()).toBe(200);
  await expect(guestPage.getByRole("heading", { name: "Monthly update", level: 1 })).toBeVisible();
  await expect(guestPage.getByText("garden chairs").first()).toBeVisible();
  // It shows the agency, never the platform.
  expect(await guestPage.title()).toContain(agencyName);
  expect(await guestPage.title()).not.toContain("SEO Platform");
  expect(await guestPage.locator("body").innerText()).not.toContain("SEO Platform");
  await expect(guestPage.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  const guestPdf = await guest.request.get(`${link}/pdf`);
  expect(guestPdf.status()).toBe(200);
  expect((await guestPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // An expired link returns 404.
  await expireShareLink("Monthly update");
  const expired = await guestPage.goto(link);
  expect(expired?.status()).toBe(404);
  expect((await guest.request.get(`${link}/pdf`)).status()).toBe(404);

  // An expired link shows as off. Creating it again brings the same link back.
  await page.reload();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByLabel("Public link")).toHaveValue(link);
  expect((await guestPage.goto(link))?.status()).toBe(200);
  await page.getByRole("button", { name: "Turn off link" }).click();
  await expect(page.getByRole("button", { name: "Create link" })).toBeVisible();
  expect((await guestPage.goto(link))?.status()).toBe(404);
  await guest.close();

  // Delete.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slug}/reports$`));
  await expect(page.getByText("No reports yet")).toBeVisible();
});
