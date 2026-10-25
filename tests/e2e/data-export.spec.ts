import { expect, test } from "@playwright/test";
import { readZip } from "../helpers/zip";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("download your data, then delete the agency", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("export"), "Eva Export");
  const agencyName = `Export Test ${Date.now()}`;
  const slug = await createAgencyInUi(page, agencyName);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Data Dental");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { name: "Data Dental" })).toBeVisible();

  // Prepare and download.
  await page.goto(`/app/${slug}/settings`);
  await expect(page.getByRole("heading", { name: "Download your data" })).toBeVisible();
  await expect(async () => {
    await page.getByRole("button", { name: "Prepare my data" }).click();
    await expect(page.getByRole("link", { name: /^Download zip/ })).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 60_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /^Download zip/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${slug}-data-\\d{4}-\\d{2}-\\d{2}\\.zip$`),
  );
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const files = readZip(Buffer.concat(chunks));
  expect(files.get("clients.jsonl")).toContain("Data Dental");
  expect(files.get("agency.jsonl")).toContain(agencyName);
  expect(files.has("README.txt")).toBe(true);

  // Someone else cannot fetch it.
  const link = await page.getByRole("link", { name: /^Download zip/ }).getAttribute("href");
  const anonymous = await page.context().browser()!.newContext();
  const denied = await anonymous.request.get(`http://localhost:3000${link}`, { maxRedirects: 0 });
  // Signed-out visitors are sent to the login page (a redirect) or refused.
  expect([302, 303, 307, 308, 401, 404]).toContain(denied.status());
  await anonymous.close();

  // Deleting needs the exact name.
  await expect(async () => {
    await page.getByRole("button", { name: "Delete agency" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("dialog").getByLabel("Agency name").fill("wrong name");
  await page.getByRole("dialog").getByRole("button", { name: "Delete agency" }).click();
  await expect(page.getByText("The name does not match.")).toBeVisible();
  await page.getByRole("dialog").getByLabel("Agency name").fill(agencyName);
  await page.getByRole("dialog").getByRole("button", { name: "Delete agency" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding/);
  expect((await page.goto(`/app/${slug}`))?.status()).toBe(404);
});
