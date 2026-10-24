import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("usage page shows bars for each limit and the reset date", async ({ page }) => {
  await signUpAndVerify(page, newEmail("usage"), "Olivia Owner");
  const slug = await createAgencyInUi(page, `Usage Test ${Date.now()}`);

  // Use some of the plan first: add two clients.
  for (const name of ["Client One", "Client Two"]) {
    await page.goto(`/app/${slug}/clients/new`);
    await expect(page.getByLabel("Client name")).toBeVisible();
    await page.getByLabel("Client name").fill(name);
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }

  await page.goto(`/app/${slug}/usage`);
  await expect(page.getByRole("heading", { name: "Usage", level: 1 })).toBeVisible();
  await expect(page.getByText("Starter plan (free trial)")).toBeVisible();
  await expect(
    page.getByText(/Monthly counts reset on [A-Z][a-z]+ \d{1,2}, \d{4}\./),
  ).toBeVisible();

  const clients = page.getByRole("progressbar", { name: "Clients" });
  await expect(clients).toHaveAttribute("aria-valuenow", "40");
  await expect(clients).toHaveAttribute("aria-valuetext", "2 of 5");
  await expect(page.getByRole("progressbar", { name: "Live rank checks" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(page.getByRole("progressbar", { name: /Team members/ })).toHaveAttribute(
    "aria-valuetext",
    "1 of 2",
  );

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});
