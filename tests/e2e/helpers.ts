import { expect, type Page } from "@playwright/test";
import { extractLink, waitForEmail } from "../helpers/mailpit";

export const PASSWORD = "correct-horse-battery";
let counter = 0;
export const newEmail = (prefix = "e2e") => `${prefix}${Date.now()}${counter++}@example.test`;

/** Signs up, opens the verification link from the inbox and ends up signed in. */
export async function signUpAndVerify(
  page: Page,
  email: string,
  name = "Test Person",
  next?: string,
) {
  await page.goto(
    next
      ? `/signup?next=${encodeURIComponent(next)}&email=${encodeURIComponent(email)}`
      : "/signup",
  );
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/verify-email/);
  const mail = await waitForEmail(email, /confirm/i);
  await page.goto(extractLink(mail, /verify-email/));
}

export async function createAgencyInUi(page: Page, name: string): Promise<string> {
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Agency name").fill(name);
  await page.getByRole("button", { name: "Create agency" }).click();
  await expect(page).toHaveURL(/\/app\/(?!onboarding)[a-z0-9-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/**
 * Waits until React has taken over an element, so clicks and typing are not lost. Without this, a
 * fast test can interact with a page that has not finished loading its scripts.
 */
export async function waitForHydration(page: Page, selector = "form, input, button") {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((key) => key.startsWith("__reactProps"));
  }, selector);
}
