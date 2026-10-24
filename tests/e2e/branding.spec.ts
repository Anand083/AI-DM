import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("change the color and the logo, see the preview update, save, and see the logo in the app", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signUpAndVerify(page, newEmail("brand"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Brand Test ${Date.now()}`);

  await page
    .getByRole("navigation", { name: "Main" })
    .first()
    .getByRole("link", { name: "Branding" })
    .click();
  await expect(page.getByRole("heading", { name: "Branding", level: 1 })).toBeVisible();
  const preview = page.getByTestId("brand-preview");
  // Starts with the agency name and the default dark color.
  await expect(preview.getByTestId("preview-name")).toContainText("Brand Test");
  await expect(page.getByLabel("Main color", { exact: true })).toHaveValue("#18181b");

  // The name and colours update the preview as you type.
  await page.getByLabel("Name your clients see").fill("Bright Studio");
  await expect(preview.getByTestId("preview-name")).toHaveText("Bright Studio");
  await page.getByLabel("Main color", { exact: true }).fill("#f5c518");
  const header = preview.locator("div").first();
  await expect(header).toHaveCSS("background-color", "rgb(245, 197, 24)");
  await expect(header).toHaveCSS("color", "rgb(0, 0, 0)"); // dark text on a light color
  await expect(
    page.getByRole("status").filter({ hasText: "main color is hard to read with white text" }),
  ).toBeVisible();
  await page.getByLabel("Main color", { exact: true }).fill("#7c3aed");
  await expect(header).toHaveCSS("background-color", "rgb(124, 58, 237)");
  await expect(header).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByRole("status").filter({ hasText: "hard to read" })).toHaveCount(0);

  // A logo.
  const png = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#ff7a00" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Logo")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  const previewLogo = preview.getByRole("img", { name: "Bright Studio logo" });
  await expect(previewLogo).toBeVisible();
  expect(await previewLogo.getAttribute("src")).toMatch(/^blob:/);

  await page.getByLabel("Support email (optional)").fill("help@brightstudio.example");
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Branding saved." })).toBeVisible();

  // It is saved: after a reload the logo comes from our server, and the app shows it too.
  await page.reload();
  await expect(page.getByLabel("Name your clients see")).toHaveValue("Bright Studio");
  await expect(page.getByLabel("Main color", { exact: true })).toHaveValue("#7c3aed");
  await expect(page.getByLabel("Support email (optional)")).toHaveValue(
    "help@brightstudio.example",
  );
  await expect(preview.getByRole("img", { name: "Bright Studio logo" })).toHaveAttribute(
    "src",
    /\/branding\/logo\?v=/,
  );
  await expect(page.locator('aside img[src*="/branding/logo"]').first()).toBeVisible();
  const logoResponse = await page.request.get(`/app/${slug}/branding/logo`);
  expect(logoResponse.status()).toBe(200);
  expect(logoResponse.headers()["content-type"]).toBe("image/png");

  // Not allowed: SVG and big files.
  await page.getByLabel("Logo").setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
  });
  await expect(
    page.getByText("SVG images are not allowed. Use a PNG, JPG or WebP image."),
  ).toBeVisible();
  await page
    .getByLabel("Logo")
    .setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(1_200_000, 1) });
  await expect(page.getByText("The logo must be 1 MB or smaller.")).toBeVisible();

  // A file that says it is a PNG but is not: the server says no.
  await page.getByLabel("Logo").setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not really an image"),
  });
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByText("Use a PNG, JPG or WebP image.")).toBeVisible();

  // Remove the logo.
  await page.reload();
  await page.getByRole("button", { name: "Remove logo" }).click();
  await expect(preview.getByRole("img")).toHaveCount(0);
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Branding saved." })).toBeVisible();
  expect((await page.request.get(`/app/${slug}/branding/logo`)).status()).toBe(404);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});
