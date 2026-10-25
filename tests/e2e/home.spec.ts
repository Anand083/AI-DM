import { expect, test } from "@playwright/test";

test("home page opens and shows the app name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The name of the platform is in the header, and the tab title carries it too.
  await expect(page.getByRole("link", { name: "SEO Platform", exact: true }).first()).toBeVisible();
  await expect(page).toHaveTitle(/SEO Platform/);
});
