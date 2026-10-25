import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "../e2e/helpers";

test("the deployed app lets a new person sign up, confirm their email and create an agency", async ({
  page,
}) => {
  await signUpAndVerify(page, newEmail("smoke"), "Smoke Test");
  const slug = await createAgencyInUi(page, `Smoke ${Date.now()}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Smoke");
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  // The data reaches the database and comes back.
  await page.goto(`/app/${slug}/clients`);
  await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
});
