import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("create a client and a project, see them listed, then archive and delete", async ({
  page,
}) => {
  await signUpAndVerify(page, newEmail("clients"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Clients Test ${Date.now()}`);

  // Empty state first.
  await page.goto(`/app/${slug}/clients`);
  await expect(page.getByText("No clients yet")).toBeVisible();

  // Add a client.
  await page.getByRole("link", { name: "Add client" }).first().click();
  await page.getByLabel("Client name").fill("Bright Dental");
  await page.getByLabel("Website (optional)").fill("https://www.brightdental.com/");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { name: "Bright Dental" })).toBeVisible();
  await expect(page.getByText("https://brightdental.com")).toBeVisible();

  // Add a project for the client.
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Main website");
  await page.getByLabel("Website domain").fill("https://www.BrightDental.com/services");
  await page.getByLabel("Country").selectOption({ label: "United Kingdom" });
  await page.getByLabel("Device").selectOption("MOBILE");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  const table = page.getByRole("table", { name: "Projects" });
  await expect(table.getByRole("link", { name: "Main website" })).toBeVisible();
  await expect(table.getByText("brightdental.com", { exact: true })).toBeVisible();
  await expect(table.getByText("United Kingdom, English, mobile")).toBeVisible();

  // Both appear in the lists.
  await page.goto(`/app/${slug}/clients`);
  const clientsTable = page.getByRole("table", { name: "Clients" });
  await expect(clientsTable.getByRole("link", { name: "Bright Dental" })).toBeVisible();
  await page.goto(`/app/${slug}/projects`);
  await expect(
    page.getByRole("table", { name: "Projects" }).getByText("Bright Dental"),
  ).toBeVisible();

  // Search works.
  await page.getByLabel("Search projects").fill("nothing-like-this");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No projects found")).toBeVisible();

  // A bad domain shows a clear message.
  await page.goto(`/app/${slug}/clients`);
  await page.getByRole("link", { name: "Bright Dental" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Broken");
  await page.getByLabel("Website domain").fill("localhost");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByText("Enter a valid domain, like example.com.")).toBeVisible();

  // Archive then restore.
  await page.goto(`/app/${slug}/clients`);
  await page.getByRole("link", { name: "Bright Dental" }).click();
  await page.getByRole("button", { name: "Archive client" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Client archived." })).toBeVisible();
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Restore client" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Client restored." })).toBeVisible();

  // Delete with confirmation.
  await page.getByRole("button", { name: "Delete client" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete client" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slug}/clients$`));
  await expect(page.getByText("No clients yet")).toBeVisible();
});

test("the plan limit shows an upgrade message", async ({ page }) => {
  await signUpAndVerify(page, newEmail("limit"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Limit Test ${Date.now()}`);
  for (let i = 1; i <= 5; i++) {
    await page.goto(`/app/${slug}/clients/new`);
    await expect(page.getByLabel("Client name")).toBeVisible();
    await page.getByLabel("Client name").fill(`Client ${i}`);
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByRole("heading", { name: `Client ${i}` })).toBeVisible();
  }
  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Client 6");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(
    page.getByText("Your Starter plan allows up to 5 clients. Upgrade your plan to add more."),
  ).toBeVisible();
});
