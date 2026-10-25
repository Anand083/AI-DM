import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify, waitForHydration } from "./helpers";

test("create an API key, use it, add a webhook and set my email choice", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("integ"), "Ines Integrations");
  const slug = await createAgencyInUi(page, `Integ ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Api Client");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { name: "Api Client" })).toBeVisible();

  await page.goto(`/app/${slug}/integrations`);
  await waitForHydration(page, "form");
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await page.getByLabel("Key name").fill("Test key");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.getByTestId("new-api-key").textContent())!.trim();
  expect(key.startsWith("aidm_")).toBe(true);
  await expect(page.getByRole("list", { name: "API keys" })).toContainText("Test key");

  // The key works, and only for what it may read.
  const ok = await page.request.get("/api/v1/clients", {
    headers: { Authorization: `Bearer ${key}` },
  });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.data.map((c: { name: string }) => c.name)).toContain("Api Client");
  const denied = await page.request.get("/api/v1/alerts", {
    headers: { Authorization: `Bearer ${key}` },
  });
  expect(denied.status()).toBe(403);
  expect((await page.request.get("/api/v1/clients")).status()).toBe(401);

  // Revoke it.
  await page.getByRole("button", { name: "Revoke Test key" }).click();
  await expect(page.getByText('Key "Test key" revoked.')).toBeVisible();
  const gone = await page.request.get("/api/v1/clients", {
    headers: { Authorization: `Bearer ${key}` },
  });
  expect(gone.status()).toBe(401);

  // Webhooks: a private address is refused, a public one is saved.
  await page.getByLabel("Web address").fill("https://192.168.1.5/hook");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByText("That address points to a private or local place.")).toBeVisible();
  await page.getByLabel("Web address").fill("https://hooks.example.com/abc");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByRole("list", { name: "Webhooks" })).toContainText(
    "https://hooks.example.com/abc",
  );
  await page.getByRole("button", { name: "Turn off https://hooks.example.com/abc" }).click();
  await expect(page.getByText("Webhook turned off.")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // My own email choice.
  await page.goto(`/app/${slug}/settings`);
  await waitForHydration(page, "form");
  const box = page.getByLabel("Email me the morning summary of new alerts");
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(page.getByText("Your email choice is saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Email me the morning summary of new alerts")).not.toBeChecked();
});
