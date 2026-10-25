import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForEmail } from "../helpers/mailpit";
import { createAgencyInUi, newEmail, PASSWORD, signUpAndVerify } from "./helpers";

async function addClientWithProject(page: Page, slug: string, client: string, project: string) {
  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel("Client name").fill(client);
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "Add project" }).first().click();
  await page.getByLabel("Project name").fill(project);
  await page.getByLabel("Website domain").fill(`${project.toLowerCase()}.example`);
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  const clientUrl = page.url();
  await page.getByRole("table", { name: "Projects" }).getByRole("link", { name: project }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  return { projectUrl: page.url().split("?")[0]!, clientUrl };
}

test("milestones, an approval the client answers, comments both ways, and templates", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signUpAndVerify(page, newEmail("collab"), "Cleo Collab");
  const slug = await createAgencyInUi(page, `Collab Agency ${Date.now()}`);
  const alpha = await addClientWithProject(page, slug, "Client Alpha", "Alpha");

  // A milestone and a task linked to it, shown to the client, with an approval request.
  await page.goto(`${alpha.projectUrl}/milestones`);
  await expect(page.getByText("No milestones yet.")).toBeVisible();
  await page.getByLabel("New milestone").fill("a");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByText("Write a title of at least 3 characters.")).toBeVisible();
  await page.getByLabel("New milestone").fill("Launch the new homepage");
  await page.getByLabel("Due date (optional)").fill("2030-06-30");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByRole("list", { name: "Milestones" })).toContainText(
    "Launch the new homepage",
  );
  await expect(page.getByText("No tasks linked yet.")).toBeVisible();

  await page.goto(`/app/${slug}/tasks`);
  await page.locator("summary", { hasText: "Add a task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Write the new homepage text");
  await page.getByLabel("Project (optional)").selectOption({ label: "Alpha" });
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added." })).toBeVisible();
  await page.getByRole("link", { name: "Write the new homepage text" }).click();
  await page.getByLabel("Milestone").selectOption({ label: "Launch the new homepage" });
  await page.getByLabel("Show this task to the client in their portal").check();
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task saved." })).toBeVisible();
  await page.getByRole("button", { name: "Ask the client to approve" }).click();
  await expect(page.getByText("Waiting for the client")).toBeVisible();
  // A private note and a comment for the client.
  await page.getByLabel("Add a comment").fill("Private: the client dislikes long text.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("list", { name: "Comments" })).toContainText("Team only");
  await page.getByLabel("Add a comment").fill("Please read the draft and tell us what you think.");
  await page.getByLabel("Visible to the client").check();
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("list", { name: "Comments" })).toContainText("Visible to the client");
  const taskUrl = page.url();

  // A report to comment on.
  await page.goto(`/app/${slug}/reports/new`);
  await page.getByLabel("Project").selectOption({ label: "Alpha (Client Alpha)" });
  await page.getByLabel("Title (optional)").fill("Alpha monthly");
  await page.getByRole("button", { name: "Create report" }).click();
  await expect(page.getByRole("link", { name: "Download PDF" }).first()).toBeVisible({
    timeout: 60_000,
  });
  const reportUrl = page.url();

  // Invite the client.
  const clientEmail = newEmail("client");
  await page.goto(alpha.clientUrl);
  await page.getByLabel("Invite by email").fill(clientEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`${clientEmail} `)).toBeVisible();
  const mail = await waitForEmail(clientEmail, /invited you/);
  const link = extractLink(mail, /\/portal\/.+\/invite\//);

  const guest = await browser.newContext();
  const client = await guest.newPage();
  await client.goto(link);
  await client.getByLabel("Your name").fill("Carl Client");
  await client.getByLabel("Choose a password").fill(PASSWORD);
  await client.getByRole("button", { name: "Create my access" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${slug}$`));

  // The client sees the task, progress, and only the shared comment.
  await client.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(client.getByText("1 task is waiting for your answer.")).toBeVisible();
  await client.getByRole("link", { name: "Write the new homepage text" }).click();
  await expect(client.getByRole("list", { name: "Comments" })).toContainText(
    "Please read the draft",
  );
  await expect(client.locator("body")).not.toContainText("dislikes long text");
  await expect(client.locator("body")).not.toContainText("Cleo Collab");
  const results = await new AxeBuilder({ page: client }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);

  // Changes need a note.
  await client.getByRole("button", { name: "Ask for changes" }).click();
  await expect(client.getByText("Tell the agency what to change.")).toBeVisible();
  await client
    .getByLabel("Note (needed if you ask for changes)")
    .fill("Please add our phone number.");
  await client.getByRole("button", { name: "Ask for changes" }).click();
  await expect(client.getByText(/The client asked for changes\./)).toBeVisible();
  await client.getByLabel("Write to your agency").fill("Thanks, waiting for the new version.");
  await client.getByRole("button", { name: "Send comment" }).click();
  await expect(client.getByRole("list", { name: "Comments" })).toContainText(
    "waiting for the new version",
  );

  // The team sees the answer and the comment, asks again, and the client approves.
  await page.goto(taskUrl);
  await expect(page.getByText("The client asked for changes")).toBeVisible();
  await expect(page.getByText("The client wrote: Please add our phone number.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Comments" })).toContainText("Client");
  await page.getByRole("button", { name: "Ask for approval again" }).click();
  await expect(page.getByText("Waiting for the client")).toBeVisible();
  await client.reload();
  await client.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(client.getByText(/Approved by the client\./)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Approved by the client")).toBeVisible();

  // Progress in the portal.
  await client.goto(`/portal/${slug}`);
  await client.getByRole("link", { name: "Alpha" }).click();
  await expect(client.getByRole("list", { name: "Milestones" })).toContainText(
    "Launch the new homepage",
  );
  await expect(client.getByText("0 of 1 tasks done (0%).")).toBeVisible();

  // Report comments both ways.
  await page.goto(reportUrl);
  await page.getByLabel("Add a comment").fill("Here is the first monthly report.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("list", { name: "Report comments" })).toContainText(
    "first monthly report",
  );
  await client.goto(`/portal/${slug}/reports`);
  await client
    .getByRole("link", { name: /Alpha monthly/ })
    .first()
    .click();
  await expect(client.getByRole("list", { name: "Report comments" })).toContainText(
    "first monthly report",
  );
  await client.getByLabel("Add a comment").fill("Why did one keyword drop?");
  await client.getByRole("button", { name: "Post comment" }).click();
  await expect(client.getByRole("list", { name: "Report comments" })).toContainText(
    "Why did one keyword drop?",
  );
  await page.reload();
  await expect(page.getByRole("list", { name: "Report comments" })).toContainText(
    "Why did one keyword drop?",
  );

  // The agency got alerts for what the client did.
  await page.goto(`/app/${slug}/alerts`);
  await expect(page.getByRole("heading", { name: "A client asked for changes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A client approved a task" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A client commented on a report" })).toBeVisible();

  // Templates.
  await page.goto(`/app/${slug}/tasks`);
  await page.locator("summary", { hasText: "Start from a template" }).click();
  await page
    .getByLabel("Template", { exact: true })
    .selectOption({ label: "New client onboarding (5 tasks)" });
  await page.getByRole("button", { name: "Add the tasks" }).click();
  await expect(page.getByRole("status").filter({ hasText: "5 tasks added." })).toBeVisible();
  await page.getByLabel("Template name").fill("Quarterly review");
  await page.getByLabel("Tasks, one a line").fill("ab\nPull the numbers | 2 | high");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Line 1: the title needs 3 to 200 characters.")).toBeVisible();
  await page
    .getByLabel("Tasks, one a line")
    .fill("Pull the numbers | 2 | high\nWrite the plan | 5");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("list", { name: "Your templates" })).toContainText(
    "Quarterly review (2 tasks)",
  );

  await guest.close();
});
