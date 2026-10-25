import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { totp } from "../helpers/totp";
import { makeSuperAdmin } from "./db";
import { newEmail, PASSWORD, signUpAndVerify, waitForHydration } from "./helpers";

/** Types the credentials and waits for the next step. The first click can land before the page is ready. */
async function signIn(page: Page, email: string, expectation: () => Promise<void>) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await expect(async () => {
    await page.getByRole("button", { name: "Sign in" }).click();
    await expectation();
  }).toPass({ timeout: 30_000 });
}

test("two-step sign in: set up, sign in with a code and with a backup code, required for admins", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const email = newEmail("twofa");
  await signUpAndVerify(page, email, "Tina TwoStep");

  // An admin without two-step sign in is sent to set it up first.
  await makeSuperAdmin(email, { withTwoFactor: false });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/account\/security\?required=1/);
  await expect(page.getByText("Admins must turn on two-step sign in")).toBeVisible();

  // Set up.
  await waitForHydration(page, "section button");
  await page.getByRole("button", { name: "Set up two-step sign in" }).click();
  await page.getByLabel("Your password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That password is not right.")).toBeVisible();
  await page.getByLabel("Your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = (await page.getByTestId("totp-secret").innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  const backupCodes = await page
    .getByRole("list", { name: "Backup codes" })
    .getByRole("listitem")
    .allInnerTexts();
  expect(backupCodes.length).toBeGreaterThanOrEqual(5);

  // A wrong code does not turn it on; the right one does.
  await page.getByLabel(/Enter the 6-digit code/).fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("That code is not right.")).toBeVisible();
  await page.getByLabel(/Enter the 6-digit code/).fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Two-step sign in is on.")).toBeVisible();
  await expect(page.getByText("On", { exact: true })).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Now the admin area opens.
  expect((await page.goto("/admin"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  // Signing in asks for the code.
  await context.clearCookies();
  await signIn(page, email, async () => {
    await expect(page.getByRole("form", { name: "Two-step sign in" })).toBeVisible({
      timeout: 4000,
    });
  });
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That code is not right.")).toBeVisible();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app/);

  // A backup code works once.
  await context.clearCookies();
  await signIn(page, email, async () => {
    await expect(page.getByRole("form", { name: "Two-step sign in" })).toBeVisible({
      timeout: 4000,
    });
  });
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code").fill(backupCodes[0]!);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app/);
  await context.clearCookies();
  await signIn(page, email, async () => {
    await expect(page.getByRole("form", { name: "Two-step sign in" })).toBeVisible({
      timeout: 4000,
    });
  });
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code").fill(backupCodes[0]!);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That code is not right.")).toBeVisible();
});

test("the sessions list shows devices and signs one out", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const email = newEmail("sessions");
  await signUpAndVerify(page, email, "Sam Sessions");

  // A second browser signs in.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, email, async () => {
    await expect(otherPage).toHaveURL(/\/app/, { timeout: 4000 });
  });

  await page.goto("/account/security");
  await waitForHydration(page, "ul button");
  const list = page.getByRole("list", { name: "Sessions" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText("This device")).toBeVisible();
  await list.getByRole("button", { name: /^Sign out/ }).click();
  await expect(page.getByText("Signed out on that device.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  // The other browser is signed out.
  await otherPage.goto("/account/security");
  await expect(otherPage).toHaveURL(/\/login/);
  await other.close();
});
