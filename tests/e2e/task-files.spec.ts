import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify, waitForHydration } from "./helpers";

test("add a file to a task, download it, and remove it", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, newEmail("files"), "Fiona Files");
  const slug = await createAgencyInUi(page, `Files ${Date.now()}`);

  await page.goto(`/app/${slug}/tasks`);
  await waitForHydration(page, "summary");
  await page.locator("summary", { hasText: "Add a task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Collect the brand brief");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added." })).toBeVisible();
  await page.getByRole("link", { name: "Collect the brand brief" }).click();
  await waitForHydration(page, "form");

  // A risky file is refused with a clear message.
  await page.getByLabel("Add a file").setInputFiles({
    name: "trick.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0x41, 0x00, 0x42]),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Use a PNG, JPG, WebP, GIF, PDF, TXT or CSV file.")).toBeVisible();

  // A text file works and can be downloaded as a file.
  await page.getByLabel("Add a file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("brand colours: green and white"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("File added.")).toBeVisible();
  const link = page
    .getByRole("list", { name: "Task files" })
    .getByRole("link", { name: "notes.txt" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe("brand colours: green and white");
  expect(res.headers()["content-disposition"]).toContain("attachment");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(page.getByText("Removed notes.txt.")).toBeVisible();
  await expect(page.getByText("No files yet.")).toBeVisible();
  expect((await page.request.get(href)).status()).toBe(404);
});
