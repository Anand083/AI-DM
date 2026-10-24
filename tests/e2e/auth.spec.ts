import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForEmail } from "../helpers/mailpit";

const PASSWORD = "correct-horse-battery";
let counter = 0;
const newEmail = () => `e2e${Date.now()}${counter++}@example.test`;

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/verify-email/);
}

test("sign up, confirm email from the inbox, sign in and sign out", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const mail = await waitForEmail(email, /confirm/i);
  const link = extractLink(mail, /verify-email/);
  await page.goto(link);
  await expect(page).toHaveURL(/\/app\/onboarding/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
});

test("an unverified user cannot sign in or open /app", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "confirm your email" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a visitor without a session is sent to the login page", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
});

test("wrong password shows a clear error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Wrong email or password" }),
  ).toBeVisible();
});

test("reset password with the emailed link", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  const verifyMail = await waitForEmail(email, /confirm/i);
  await page.goto(extractLink(verifyMail, /verify-email/));
  await expect(page).toHaveURL(/\/app/);
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "we sent a link" })).toBeVisible();

  const resetMail = await waitForEmail(email, /reset your password/i);
  await page.goto(extractLink(resetMail, /reset-password/));
  await expect(page).toHaveURL(/reset-password\?token=/);
  const newPassword = "a-brand-new-password-1";
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Repeat new password").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
});
