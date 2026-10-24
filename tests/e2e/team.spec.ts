import { expect, test } from "@playwright/test";
import { extractLink, waitForEmail } from "../helpers/mailpit";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("new user creates an agency and lands on its dashboard", async ({ page }) => {
  await signUpAndVerify(page, newEmail("owner"), "Olivia Owner");
  const name = `Acme ${Date.now()}`;
  const slug = await createAgencyInUi(page, name);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  expect(slug).toMatch(/^acme-/);
});

test("owner invites a member, who accepts from the email link and sees the agency", async ({
  page,
  browser,
}) => {
  // Owner creates the agency.
  await signUpAndVerify(page, newEmail("owner"), "Olivia Owner");
  const agencyName = `Team Test ${Date.now()}`;
  const slug = await createAgencyInUi(page, agencyName);

  // Owner invites a new person.
  const inviteeEmail = newEmail("invitee");
  await page.goto(`/app/${slug}/team`);
  await page.getByLabel("Email").fill(inviteeEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation sent." })).toBeVisible();
  await expect(page.getByText(inviteeEmail)).toBeVisible();

  // The invited person opens the link in their own browser session.
  const mail = await waitForEmail(inviteeEmail, /invited/i);
  expect(mail.HTML).toContain(agencyName);
  const link = extractLink(mail, /\/invite\//);
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: `Join ${agencyName}` })).toBeVisible();
  await guest.getByRole("link", { name: "Create an account" }).click();
  await expect(guest.getByLabel("Work email")).toHaveValue(inviteeEmail);

  // Sign up with that email and confirm it; the confirmation link returns to the invitation.
  await guest.getByLabel("Your name").fill("Mia Member");
  await guest.getByLabel("Password").fill("correct-horse-battery");
  await guest.getByRole("button", { name: "Create account" }).click();
  await expect(guest).toHaveURL(/verify-email/);
  const verifyMail = await waitForEmail(inviteeEmail, /confirm/i);
  await guest.goto(extractLink(verifyMail, /verify-email/));
  await expect(guest).toHaveURL(/\/invite\//);

  await guest.getByRole("button", { name: "Accept invitation" }).click();
  await expect(guest).toHaveURL(new RegExp(`/app/${slug}$`));
  await expect(guest.getByRole("heading", { name: agencyName })).toBeVisible();

  // A member sees the team but has no invite form.
  await guest.goto(`/app/${slug}/team`);
  await expect(guest.getByText("Mia Member (you)")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Send invitation" })).toHaveCount(0);

  // The owner sees the new member and no pending invitation.
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Mia Member" })).toBeVisible();
  await expect(page.getByText("No pending invitations.")).toBeVisible();
  await context.close();
});

test("a stranger gets a 404 for someone else's agency", async ({ page, browser }) => {
  await signUpAndVerify(page, newEmail("owner"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Private ${Date.now()}`);

  const context = await browser.newContext();
  const other = await context.newPage();
  await signUpAndVerify(other, newEmail("other"), "Other Person");
  const response = await other.goto(`/app/${slug}/team`);
  expect(response?.status()).toBe(404);
  await context.close();
});
