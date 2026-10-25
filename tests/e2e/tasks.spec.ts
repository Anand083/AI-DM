import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAgencyInUi, newEmail, signUpAndVerify } from "./helpers";

test("make a task from an audit issue, work on it, and keep track of due dates", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signUpAndVerify(page, newEmail("tasks"), "Tess Tasks");
  const slug = await createAgencyInUi(page, `Tasks Test ${Date.now()}`);

  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill("Green Garden");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill("Garden site");
  await page.getByLabel("Website domain").fill("greengarden.example");
  await page.getByRole("button", { name: "Add project" }).click();
  await page
    .getByRole("table", { name: "Projects" })
    .getByRole("link", { name: "Garden site" })
    .click();

  // An audit, then a task from its first problem.
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await page.getByRole("button", { name: "Run first audit" }).click();
  await expect(page.getByRole("heading", { name: "Audit results" })).toBeVisible({
    timeout: 90_000,
  });
  const auditUrl = page.url();
  const first = page.locator("details").first();
  await first.locator("summary").click();
  await first.getByRole("button", { name: "Create task" }).click();
  await expect(first.getByText("Task created.")).toBeVisible();
  await first.getByRole("link", { name: "Open the task" }).click();

  // The task has the text of the problem.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fix:");
  await expect(page.getByLabel("Description")).toHaveValue(/How to fix it/);
  await expect(page.getByRole("link", { name: "site audit" })).toBeVisible();

  // Change it and talk about it.
  await page.getByLabel("Status").selectOption("IN_PROGRESS");
  await page.getByLabel("Estimated minutes").fill("45");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task saved." })).toBeVisible();
  await page.getByLabel("Add a comment").fill("I will fix this on Friday.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("list", { name: "Comments" })).toContainText(
    "I will fix this on Friday.",
  );

  // The same issue gives the same task, not a second one.
  await page.goto(auditUrl);
  const again = page.locator("details").first();
  await again.locator("summary").click();
  await again.getByRole("button", { name: "Create task" }).click();
  await expect(again.getByText("A task for this issue is already open.")).toBeVisible();

  // The tasks page, with a late task and a repeating one.
  await page.goto(`/app/${slug}/tasks`);
  await expect(page.getByRole("table", { name: "Tasks" }).getByRole("row")).toHaveCount(2);
  await page.locator("summary", { hasText: "Add a task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Hi");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Write a title of at least 3 characters.")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Send the monthly update");
  await page.getByLabel("Due date").fill("2020-01-15");
  await page.getByLabel("Repeats").selectOption("MONTHLY");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added." })).toBeVisible();
  const table = page.getByRole("table", { name: "Tasks" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByText("Overdue")).toBeVisible();
  await page.getByRole("link", { name: "Overdue", exact: true }).click();
  await expect(page.getByRole("table", { name: "Tasks" }).getByRole("row")).toHaveCount(2);

  // Finishing the repeating task makes the next one.
  await page.getByRole("button", { name: "Mark done: Send the monthly update" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Done. The next one is ready." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open", exact: true }).click();
  await expect(page.getByRole("link", { name: "Send the monthly update" })).toBeVisible();
  await page.getByRole("link", { name: "Done", exact: true }).click();
  await expect(page.getByRole("link", { name: "Send the monthly update" })).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Delete one.
  await page.getByRole("link", { name: "Send the monthly update" }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slug}/tasks$`));
});
