import { expect, test } from "@playwright/test";
import { extractLink, waitForEmail } from "../helpers/mailpit";
import { markDomainVerified, seedRankings, setPlan } from "./db";
import { createAgencyInUi, newEmail, PASSWORD, signUpAndVerify } from "./helpers";

// Every run uses its own name, because a domain can only belong to one agency.
const DOMAIN = `agency-one-${Date.now()}.localhost`;
const ORIGIN = `http://${DOMAIN}:3000`;

test("a verified custom domain shows the agency's client portal", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, newEmail("domain"), "Dana Domain");
  const slug = await createAgencyInUi(page, `Agency One ${Date.now()}`);

  // The Starter plan has no custom domain.
  await page.goto(`/app/${slug}/branding`);
  await expect(page.getByRole("heading", { name: "Your own domain" })).toBeVisible();
  await expect(page.getByText("Your plan does not include a custom domain.")).toBeVisible();
  await setPlan(slug, "GROWTH");

  // Bad input, then a good domain with DNS steps.
  await page.reload();
  await page.getByLabel("Domain", { exact: true }).fill("not a domain");
  await page.getByRole("button", { name: "Save domain" }).click();
  await expect(page.getByText("Enter a domain like reports.youragency.com.")).toBeVisible();
  await page.getByLabel("Domain", { exact: true }).fill(DOMAIN);
  await page.getByRole("button", { name: "Save domain" }).click();
  const records = page.getByRole("table", { name: "DNS records" });
  await expect(records.getByText("CNAME", { exact: true })).toBeVisible();
  await expect(records.getByText(`_portal-verify.${DOMAIN}`)).toBeVisible();
  await expect(page.getByText("Waiting for DNS")).toBeVisible();

  // The DNS records do not exist, so verifying says so in plain words.
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(
    page.getByText(/We could not find the TXT record and the CNAME record yet/),
  ).toBeVisible();

  // Pretend DNS is set up.
  await markDomainVerified(slug);
  await page.reload();
  await expect(page.getByText(`https://${DOMAIN}`)).toBeVisible();

  // Something to look at in the portal.
  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Green Garden");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Shop");
  await page.getByLabel("Website domain").fill("shop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  const clientUrl = page.url();
  await page.getByRole("table", { name: "Projects" }).getByRole("link", { name: "Shop" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  await seedRankings(slug, /\/projects\/([^/?]+)/.exec(page.url())![1]!, [
    ["garden chairs", 14, 4],
  ]);

  const clientEmail = newEmail("cdclient");
  await page.goto(clientUrl);
  await page.getByLabel("Invite by email").fill(clientEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  const mail = await waitForEmail(clientEmail, /invited you/);
  const link = extractLink(mail, /\/portal\/.+\/invite\//);

  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  await visitor.goto(link);
  await visitor.getByLabel("Your name").fill("Gina Garden");
  await visitor.getByLabel("Choose a password").fill(PASSWORD);
  await visitor.getByRole("button", { name: "Create my access" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/portal/${slug}$`));
  await visitor.getByRole("button", { name: "Sign out" }).click();

  // On the custom domain, the root is the agency's portal login.
  const first = await visitor.goto(`${ORIGIN}/`);
  expect(first?.status()).toBe(200);
  await expect(visitor.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(visitor.url().startsWith(ORIGIN)).toBe(true);
  expect(await visitor.title()).toContain("Agency One");

  // Signing in works on that origin and stays on it. Wait until the page is ready for typing.
  await visitor.waitForLoadState("networkidle");
  await visitor.getByLabel("Email").fill(clientEmail);
  await visitor.getByLabel("Password").fill(PASSWORD);
  await visitor.getByRole("button", { name: "Sign in" }).click();
  await expect(visitor.getByRole("heading", { name: "Your websites" })).toBeVisible();
  expect(visitor.url().startsWith(ORIGIN)).toBe(true);
  await expect(visitor.getByRole("link", { name: "Shop" })).toBeVisible();
  const home = await visitor.goto(`${ORIGIN}/`);
  expect(home?.status()).toBe(200);
  await expect(visitor.getByRole("heading", { name: "Your websites" })).toBeVisible();
  const reports = await visitor.goto(`${ORIGIN}/reports`);
  expect(reports?.status()).toBe(200);
  await expect(visitor.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();

  // The agency app and other agencies' portals are not served on this domain.
  expect((await visitor.goto(`${ORIGIN}/app/${slug}`))?.status()).toBe(404);
  expect((await visitor.goto(`${ORIGIN}/portal/someone-else`))?.status()).toBe(404);

  // An unknown domain gets a 404, and the allowed-check answers correctly.
  expect((await visitor.goto("http://unknown-agency.localhost:3000/"))?.status()).toBe(404);
  const base = "http://localhost:3000/api/internal/domain-allowed";
  expect((await guest.request.get(`${base}?domain=${DOMAIN}`)).status()).toBe(200);
  expect((await guest.request.get(`${base}?domain=unknown-agency.localhost`)).status()).toBe(404);

  // Removing the domain ends it.
  await page.goto(`/app/${slug}/branding`);
  await page.getByRole("button", { name: "Remove domain" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove domain" }).click();
  await expect(page.getByLabel("Domain", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await guest.request.get(`${base}?domain=${DOMAIN}`)).status())
    .toBe(404);
  await guest.close();
});
