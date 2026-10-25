import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

/** Clicks until the page reacts. The first click can land before the page is ready for it. */
async function clickUntil(page: Page, button: Locator, expected: RegExp | Locator) {
  await expect(async () => {
    await button.click();
    if (expected instanceof RegExp) await expect(page).toHaveURL(expected, { timeout: 4000 });
    else await expect(expected).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 40_000 });
}

async function chooseAndPay(
  page: Page,
  slug: string,
  plan: string,
  outcome: "Pay" | "Fail payment",
) {
  await page.goto(`/app/${slug}/billing`);
  await clickUntil(
    page,
    page.getByRole("button", { name: new RegExp(`^Choose ${plan}`) }),
    page.getByRole("heading", { name: "Checkout" }),
  );
  await expect(page.getByText("This is a practice checkout.")).toBeVisible();
  await clickUntil(
    page,
    page.getByRole("button", { name: outcome, exact: true }),
    /checkout=(paid|failed)/,
  );
}

test("a trial agency upgrades to Growth through the mock checkout and gets the new limits", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("billing"), "Bea Biller");
  const slug = await createAgencyInUi(page, `Billing Test ${Date.now()}`);

  // Trial notice on every page, and the billing page.
  await expect(page.getByTestId("subscription-banner")).toContainText(
    "Your free trial ends in 14 days.",
  );
  await page.goto(`/app/${slug}/usage`);
  await expect(page.getByRole("progressbar", { name: "Clients" })).toHaveAttribute(
    "aria-valuetext",
    "0 of 5",
  );
  await page.goto(`/app/${slug}/billing`);
  await expect(page.getByRole("heading", { name: "Starter plan" })).toBeVisible();
  await expect(page.getByText("Free trial", { exact: true })).toBeVisible();
  await expect(page.getByText(/days left/)).toBeVisible();
  await expect(page.getByText("No invoices yet")).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // A failed payment changes nothing.
  await chooseAndPay(page, slug, "Growth", "Fail payment");
  await expect(page).toHaveURL(/checkout=failed/);
  await expect(page.getByText("The payment failed. Nothing was charged.")).toBeVisible();
  await expect(page.getByText("Free trial", { exact: true })).toBeVisible();

  // Paying works.
  await chooseAndPay(page, slug, "Growth", "Pay");
  await expect(page).toHaveURL(/checkout=paid/);
  await expect(
    page.getByText("Thank you. Your payment worked and your plan is active."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Growth plan" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText(/Next payment on/)).toBeVisible();
  await expect(page.getByTestId("subscription-banner")).toHaveCount(0);
  const invoices = page.getByRole("table", { name: "Invoices" });
  await expect(invoices.getByText("Growth plan, monthly")).toBeVisible();
  await expect(invoices.getByText("$149.00")).toBeVisible();

  // The new limits apply.
  await page.goto(`/app/${slug}/usage`);
  await expect(page.getByText("Growth plan")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Clients" })).toHaveAttribute(
    "aria-valuetext",
    "0 of 20",
  );

  // Downgrade waits for the end of the period; cancel and keep.
  await page.goto(`/app/${slug}/billing`);
  await page.getByRole("button", { name: /^Switch to Starter/ }).click();
  await expect(
    page.getByText("Your plan will change at the end of this billing period."),
  ).toBeVisible();
  await expect(page.getByText(/your plan changes to Starter/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel subscription" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel subscription" }).click();
  await expect(page.getByText(/Your subscription ends on/)).toBeVisible();
  await page.getByRole("button", { name: "Keep my subscription" }).click();
  await expect(page.getByText(/Next payment on/)).toBeVisible();
});

test("an expired trial is read-only until a plan is bought", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("expired"), "Eli Expired");
  const slug = await createAgencyInUi(page, `Expired Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Green Garden");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Shop");
  await page.getByLabel("Website domain").fill("shop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();

  // Move the clock past the end of the trial.
  const advance = await page.request.post("/api/dev/billing/advance", {
    data: { agency: slug, days: 15 },
  });
  expect(advance.ok()).toBe(true);

  await page.goto(`/app/${slug}/clients`);
  await expect(page.getByTestId("subscription-banner")).toContainText("Your account is read-only.");
  // Data is still visible.
  await expect(page.getByRole("link", { name: "Green Garden" })).toBeVisible();

  // New work is refused with a clear message.
  await page.goto(`/app/${slug}/reports/new`);
  await page.getByRole("button", { name: "Create report" }).click();
  await expect(
    page.getByText(/Your subscription has ended, so your account is read-only/),
  ).toBeVisible();

  // Buying a plan ends read-only mode.
  await chooseAndPay(page, slug, "Starter", "Pay");
  await expect(
    page.getByText("Thank you. Your payment worked and your plan is active."),
  ).toBeVisible();
  await expect(page.getByTestId("subscription-banner")).toHaveCount(0);
  await page.goto(`/app/${slug}/reports/new`);
  await page.getByRole("button", { name: "Create report" }).click();
  await expect(page).toHaveURL(/\/reports\/[a-z0-9]+$/);
});
