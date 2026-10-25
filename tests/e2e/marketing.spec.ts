import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { contactMessagesFrom, publicPlans } from "./db";
import { createAgencyInUi, newEmail, signUpAndVerify, waitForHydration } from "./helpers";

const PAGES = [
  ["/", /SEO tools and branded reports/],
  ["/features", /Everything you need/],
  ["/pricing", /Simple pricing/],
  ["/about", /About /],
  ["/contact", /Contact us/],
  ["/terms", /Terms of service/],
  ["/privacy", /Privacy policy/],
] as const;

test("every public page loads, has one heading, a menu and no serious accessibility problems", async ({
  page,
}) => {
  for (const [path, heading] of PAGES) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);
  }
});

test("the menu leads to the other pages and to sign up", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Pricing" })
    .click();
  await expect(page).toHaveURL(/\/pricing$/);
  await page.getByRole("link", { name: "Start free trial" }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("the pricing page shows the plans and prices that are in the database", async ({ page }) => {
  const plans = await publicPlans();
  expect(plans.length).toBeGreaterThanOrEqual(3);
  await page.goto("/pricing");
  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number.isInteger(cents / 100) ? 0 : 2,
    });
  await expect(page.getByRole("list", { name: "Plans" })).toBeVisible();
  for (const plan of plans) {
    const card = page.locator(`[data-plan="${plan.code}"]`);
    await expect(card.getByRole("heading", { name: plan.name })).toBeVisible();
    await expect(card.getByTestId(`${plan.code}-monthly`)).toHaveText(
      money(plan.priceMonthlyCents),
    );
    await expect(card.getByTestId(`${plan.code}-yearly`)).toHaveText(money(plan.priceYearlyCents));
  }
  // The order on the page is the order in the database.
  const names = await page.locator("[data-plan] h2").allInnerTexts();
  expect(names).toEqual(plans.map((p) => p.name));
});

test("the contact form sends a message, explains mistakes and ignores bots", async ({ page }) => {
  // The form allows 5 messages an hour per address, and every test run comes from the same machine.
  // A made-up address per run keeps repeated runs from using up the limit.
  const fakeIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp });
  await page.goto("/contact");
  await waitForHydration(page, "form");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  const email = newEmail("contact");
  await page.getByLabel("Your name").fill("Casey Contact");
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel("How can we help?").fill("Do you offer a discount for small agencies?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thank you. We got your message")).toBeVisible();
  const stored = await contactMessagesFrom(email);
  expect(stored).toHaveLength(1);
  expect(stored[0]!.message).toContain("discount");
});

test("the get started checklist updates as the agency does the work", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("start"), "Sasha Start");
  const slug = await createAgencyInUi(page, `Start Test ${Date.now()}`);

  const progress = page.getByTestId("checklist-progress");
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  await expect(progress).toHaveText("0 of 6 done");
  const steps = page.getByRole("list", { name: "Setup steps" });
  await expect(steps.getByRole("listitem")).toHaveCount(6);

  // The first step links to the right page; doing it ticks it off.
  await steps.getByRole("link", { name: "Add your first client" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slug}/clients/new$`));
  await page.getByLabel("Client name").fill("Green Garden");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { name: "Green Garden" })).toBeVisible();
  await page.goto(`/app/${slug}`);
  await expect(progress).toHaveText("1 of 6 done");
  await expect(steps.getByRole("listitem").first()).toHaveAttribute("data-done", "true");
  await expect(steps.getByRole("link", { name: "Add your first client" })).toHaveCount(0);

  // A project is the next step.
  await page.goto(`/app/${slug}/clients`);
  await page.getByRole("link", { name: "Green Garden" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Shop");
  await page.getByLabel("Website domain").fill("shop.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  await page.goto(`/app/${slug}`);
  await expect(progress).toHaveText("2 of 6 done");

  // Branding counts once it is saved.
  await page.goto(`/app/${slug}/branding`);
  const nameField = page.getByLabel("Name your clients see");
  await expect(nameField).toHaveValue(/Start Test/);
  await nameField.fill("Start Studio");
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByText("Branding saved.")).toBeVisible();
  await page.goto(`/app/${slug}`);
  await expect(progress).toHaveText("3 of 6 done");

  // The help page opens from the checklist.
  await page.getByRole("link", { name: "Read the help guides" }).click();
  await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Guides" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tracking rankings" })).toBeVisible();
});
