import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForEmail } from "../helpers/mailpit";
import { seedRankings } from "./db";
import { createAgencyInUi, newEmail, PASSWORD, signUpAndVerify, waitForHydration } from "./helpers";

const APP_NAME = "SEO Platform";

async function addClientWithProject(page: Page, slug: string, client: string, project: string) {
  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill(client);
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill(project);
  await page.getByLabel("Website domain").fill(`${project.toLowerCase()}.example`);
  await page.getByRole("button", { name: "Add project" }).click();
  const table = page.getByRole("table", { name: "Projects" });
  await expect(table).toBeVisible();
  const clientUrl = page.url();
  await page.getByRole("table", { name: "Projects" }).getByRole("link", { name: project }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectId = /\/projects\/([^/?]+)/.exec(page.url())![1]!;
  return { projectId, clientUrl };
}

test("a client user sees only their own client, in the agency's branding", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("owner"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Portal Agency ${Date.now()}`);

  // Branding: the name clients see.
  await page.goto(`/app/${slug}/branding`);
  const nameField = page.getByLabel("Name your clients see");
  await expect(nameField).toHaveValue(/Portal Agency/);
  await nameField.fill("Bright Studio");
  await expect(nameField).toHaveValue("Bright Studio");
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByText("Branding saved.")).toBeVisible();

  const a = await addClientWithProject(page, slug, "Client Alpha", "Alpha");
  const b = await addClientWithProject(page, slug, "Client Beta", "Beta");
  await seedRankings(slug, a.projectId, [["alpha keyword", 12, 3]]);
  await seedRankings(slug, b.projectId, [["beta secret keyword", 9, 8]]);

  // A report for Alpha, built by the worker.
  await page.goto(`/app/${slug}/reports/new`);
  await page.getByLabel("Project").selectOption({ label: "Alpha (Client Alpha)" });
  await page.getByLabel("Title (optional)").fill("Alpha monthly");
  await page.getByRole("button", { name: "Create report" }).click();
  await expect(page.getByRole("link", { name: "Download PDF" }).first()).toBeVisible({
    timeout: 60_000,
  });

  // Invite a client user from the client page.
  const clientEmail = newEmail("client");
  await page.goto(a.clientUrl);
  await page.getByLabel("Invite by email").fill(clientEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`${clientEmail} `)).toBeVisible();

  // The email shows only the agency.
  const mail = await waitForEmail(clientEmail, /Bright Studio invited you/);
  expect(mail.FromName).toBe("Bright Studio");
  expect(mail.HTML + mail.Text).not.toContain(APP_NAME);
  const link = extractLink(mail, /\/portal\/.+\/invite\//);

  // The client opens the link in a fresh browser.
  const guest = await browser.newContext();
  const client = await guest.newPage();
  await client.goto(link);
  expect(await client.title()).toContain("Bright Studio");
  await client.getByLabel("Your name").fill("Carl Client");
  await client.getByLabel("Choose a password").fill(PASSWORD);
  await client.getByRole("button", { name: "Create my access" }).click();

  await expect(client).toHaveURL(new RegExp(`/portal/${slug}$`));
  await expect(client.getByRole("heading", { name: "Your websites" })).toBeVisible();
  await expect(client.getByRole("link", { name: "Alpha" })).toBeVisible();
  await expect(client.getByText("Beta")).toHaveCount(0);

  // No platform name in title, text, favicon link.
  expect(await client.title()).not.toContain(APP_NAME);
  expect(await client.title()).toContain("Bright Studio");
  expect(await client.locator("body").innerText()).not.toContain(APP_NAME);
  const icon = await client.locator('link[rel~="icon"]').first().getAttribute("href");
  expect(icon).toContain(`/portal/${slug}/logo`);
  const iconResponse = await guest.request.get(icon!);
  expect(iconResponse.status()).toBe(200);
  expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");
  expect(await iconResponse.text()).not.toContain(APP_NAME);

  // The project page: rankings of Alpha only.
  await client.getByRole("link", { name: "Alpha" }).click();
  await expect(client.getByRole("table", { name: "Keyword rankings" })).toBeVisible();
  await expect(client.getByText("alpha keyword")).toBeVisible();
  await expect(client.getByText("beta secret keyword")).toHaveCount(0);
  const results = await new AxeBuilder({ page: client }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Another client's project is a 404, and so are the agency pages.
  const other = await client.goto(`/portal/${slug}/projects/${b.projectId}`);
  expect(other?.status()).toBe(404);
  expect((await client.goto(`/app/${slug}`))?.status()).toBe(404);

  // Reports: list, view, download.
  await client.goto(`/portal/${slug}/reports`);
  await expect(client.getByRole("link", { name: "Alpha monthly", exact: true })).toBeVisible();
  await client.getByRole("link", { name: "Alpha monthly", exact: true }).click();
  await expect(client.getByRole("heading", { name: "Alpha monthly", level: 1 })).toBeVisible();
  expect(await client.title()).not.toContain(APP_NAME);
  expect(await client.locator("body").innerText()).not.toContain(APP_NAME);
  const pdfUrl = client.url() + "/pdf";
  const pdf = await guest.request.get(pdfUrl);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Sign out, then sign in again on the branded login page.
  await client.getByRole("button", { name: "Sign out" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}/login`));
  expect(await client.title()).toContain("Bright Studio");
  expect(await client.locator("body").innerText()).not.toContain(APP_NAME);
  expect((await guest.request.get(pdfUrl, { maxRedirects: 0 })).status()).toBe(401);
  await client.getByLabel("Email").fill(clientEmail);
  await client.getByLabel("Password").fill(PASSWORD);
  await client.getByRole("button", { name: "Sign in" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}$`));

  // Forgot password: the whole flow shows only the agency.
  await waitForHydration(client, "button");
  await client.getByRole("button", { name: "Sign out" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}/login`));
  await client.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}/forgot-password`));
  expect(await client.title()).toContain("Bright Studio");
  expect(await client.locator("body").innerText()).not.toContain(APP_NAME);
  await client.getByLabel("Email").fill(clientEmail);
  await client.getByRole("button", { name: "Send reset link" }).click();
  await expect(client.getByText("If an account exists for that email")).toBeVisible();
  const resetMail = await waitForEmail(clientEmail, /Reset your password/);
  expect(resetMail.FromName).toBe("Bright Studio");
  expect(resetMail.HTML + resetMail.Text).not.toContain(APP_NAME);
  const resetLink = extractLink(resetMail, /reset-password/);
  await client.goto(resetLink);
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}/reset-password`));
  expect(await client.locator("body").innerText()).not.toContain(APP_NAME);
  const newPassword = `${PASSWORD}-new1`;
  await client.getByLabel("New password", { exact: true }).fill(newPassword);
  await client.getByLabel("Repeat new password").fill(newPassword);
  await client.getByRole("button", { name: "Save new password" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}/login\\?reset=1`));
  await expect(client.getByText("Your password was changed.")).toBeVisible();
  await client.getByLabel("Email").fill(clientEmail);
  await client.getByLabel("Password").fill(newPassword);
  await client.getByRole("button", { name: "Sign in" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}$`));

  // Removing access ends it.
  await page.goto(a.clientUrl);
  await page.getByRole("button", { name: "Remove access" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove access" }).click();
  await expect(page.getByText("No one has access yet.")).toBeVisible();
  expect((await client.goto(`/portal/${slug}`))?.status()).toBe(404);
  await guest.close();
});
