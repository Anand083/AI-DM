import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { waitForEmail } from "../helpers/mailpit";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

// Chrome stops a "public" website from reading a server on this machine. A real agency site and a
// real app server are both public, so for this test only that rule is switched off.
test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: [
      "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults",
    ],
  },
});

test("an agency puts the check on another website and gets the lead", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const owner = newEmail("widget");
  await signUpAndVerify(page, owner, "Wanda Widget");
  const agencyName = `Widget Studio ${Date.now()}`;
  const slug = await createAgencyInUi(page, agencyName);
  const origin = new URL(baseURL!).origin;

  // The Leads page gives the embed code.
  await page.goto(`/app/${slug}/leads`);
  await expect(page.getByText("No leads yet")).toBeVisible();
  await expect(page.locator("#embed-code")).toHaveValue(
    `<script src="${origin}/widget/embed.js" data-agency="${slug}" async></script>`,
  );

  // The widget page may be framed by any site, the rest of the app may not.
  const widgetPage = await page.request.get(`/widget/${slug}`);
  expect(widgetPage.status()).toBe(200);
  expect(widgetPage.headers()["x-frame-options"]).toBeUndefined();
  expect(widgetPage.headers()["content-security-policy"]).toContain("frame-ancestors *");
  expect(widgetPage.headers()["x-robots-tag"]).toContain("noindex");
  const login = await page.request.get("/login");
  expect(login.headers()["x-frame-options"]).toBe("DENY");
  expect(login.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect((await page.request.get("/widget/no-such-agency")).status()).toBe(404);
  const script = await page.request.get("/widget/embed.js");
  expect(script.headers()["content-type"]).toContain("javascript");
  expect(await script.text()).toContain("data-agency");

  // A visitor on someone else's website. The page is plain HTML with the agency's script tag.
  // Another address on this machine stands in for the agency's own website (the browser would
  // block a public website from reading localhost, which cannot happen with a real server).
  const visitor = await page.context().newPage();
  await visitor.route("http://localhost:4321/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><h1>Our friendly shop</h1><script src="${origin}/widget/embed.js" data-agency="${slug}"></script></body></html>`,
    }),
  );
  await visitor.goto("http://localhost:4321/");
  const frame = visitor.frameLocator("iframe[title='Free website check']");
  await expect(frame.getByRole("heading", { name: "Free website check" })).toBeVisible();
  await expect(frame.getByText(`by ${agencyName}`)).toBeVisible();

  // Mistakes are explained next to the field.
  await frame.getByLabel("Your website").fill("not a website");
  await frame.getByLabel("Your email").fill("buyer@example.test");
  await frame.getByRole("button", { name: "Check my website" }).click();
  await expect(frame.getByText("Enter a website like example.com.")).toBeVisible();

  await frame.getByLabel("Your website").fill("https://www.sample-prospect.example/shop");
  await frame.getByRole("button", { name: "Check my website" }).click();
  // The waiting text is only there for a few seconds, so a fast result is fine too.
  await expect(
    frame.getByRole("status").or(frame.getByRole("heading", { name: "What to fix first" })),
  ).toBeVisible();
  await expect(frame.getByRole("heading", { name: "What to fix first" })).toBeVisible({
    timeout: 120_000,
  });
  await expect(frame.getByLabel(/^Health score \d+ out of 100$/)).toBeVisible();
  expect(await frame.locator("li").count()).toBeGreaterThan(0);
  expect(await frame.locator("li").count()).toBeLessThanOrEqual(5);
  // The platform name never shows to a visitor.
  const frameText = await frame.locator("body").innerText();
  expect(frameText).not.toContain(process.env.APP_NAME ?? "SEO Platform");
  expect(frameText).not.toContain("buyer@example.test");
  await visitor.close();

  // The agency owner gets an email and sees the lead.
  const mail = await waitForEmail(owner, /New lead: buyer@example\.test/, 30_000);
  expect(mail.Text).toContain("sample-prospect.example");
  await page.goto(`/app/${slug}/leads`);
  const row = page.getByRole("table", { name: "Leads" }).getByRole("row").nth(1);
  await expect(row).toContainText("buyer@example.test");
  await expect(row).toContainText("sample-prospect.example");
  await expect(row).toContainText("Done");
  await expect(row.getByText(/\d+ problems/)).toBeVisible();

  // Accessibility of the widget on its own.
  await page.goto(`/widget/${slug}`);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // The agency can delete a lead.
  await page.goto(`/app/${slug}/leads`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No leads yet")).toBeVisible();
});
