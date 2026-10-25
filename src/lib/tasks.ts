import { addDays } from "./google-metrics";

export const TASK_STATUSES = [
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "BLOCKED", label: "Blocked" },
  { key: "DONE", label: "Done" },
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number]["key"];

export const TASK_PRIORITIES = [
  { key: "LOW", label: "Low" },
  { key: "MEDIUM", label: "Medium" },
  { key: "HIGH", label: "High" },
  { key: "URGENT", label: "Urgent" },
] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number]["key"];

export const TASK_RECURRENCES = [
  { key: "NONE", label: "Does not repeat" },
  { key: "WEEKLY", label: "Every week" },
  { key: "MONTHLY", label: "Every month" },
] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number]["key"];

export const statusLabel = (key: string) => TASK_STATUSES.find((s) => s.key === key)?.label ?? key;
export const priorityLabel = (key: string) =>
  TASK_PRIORITIES.find((p) => p.key === key)?.label ?? key;

/** Audit issue severity becomes task priority. */
export function priorityForSeverity(severity: "CRITICAL" | "WARNING" | "NOTICE"): TaskPriority {
  return severity === "CRITICAL" ? "HIGH" : severity === "WARNING" ? "MEDIUM" : "LOW";
}

/** Open means not done. A task is overdue when its day is before today. */
export const isOverdue = (dueOn: string | null, today: string, status: string) =>
  status !== "DONE" && dueOn !== null && dueOn < today;

/** The day after `date` by one month, keeping the day of the month where it exists (31 Jan gives 28 Feb). */
export function addMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m, 1)); // first day of the next month
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Due day of the next copy of a repeating task. It follows the old due day, but never lands in
 * the past: a task finished late gets the next due day after today.
 */
export function nextDueDay(
  dueOn: string | null,
  recurrence: TaskRecurrence,
  today: string,
): string | null {
  if (recurrence === "NONE") return null;
  const step = (d: string) => (recurrence === "WEEKLY" ? addDays(d, 7) : addMonth(d));
  let next = step(dueOn ?? today);
  for (let i = 0; i < 1000 && next <= today; i++) next = step(next);
  return next;
}

export type DueCounts = { overdue: number; dueToday: number };

export const APPROVAL_STATES = [
  { key: "NONE", label: "No approval needed" },
  { key: "REQUESTED", label: "Waiting for the client" },
  { key: "APPROVED", label: "Approved by the client" },
  { key: "CHANGES_REQUESTED", label: "The client asked for changes" },
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number]["key"];
export const approvalLabel = (key: string) =>
  APPROVAL_STATES.find((s) => s.key === key)?.label ?? key;

export type TemplateItem = {
  title: string;
  description: string;
  priority: TaskPriority;
  /** Days after the start day when the task is due. */
  days: number;
  estimateMinutes: number | null;
};

export type BuiltInTemplate = { key: string; name: string; items: TemplateItem[] };

const item = (
  title: string,
  days: number,
  priority: TaskPriority = "MEDIUM",
  description = "",
  estimateMinutes: number | null = null,
): TemplateItem => ({ title, description, priority, days, estimateMinutes });

/** Ready-made task lists that every agency can use. */
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    key: "onboarding",
    name: "New client onboarding",
    items: [
      item("Get access to Search Console and Analytics", 2, "HIGH"),
      item("Add the keywords to track", 3, "HIGH"),
      item("Run the first site audit and read the results", 5, "HIGH"),
      item("Agree the goals and the reporting dates with the client", 7),
      item("Set up the branded report and the schedule", 10),
    ],
  },
  {
    key: "monthly",
    name: "Monthly SEO routine",
    items: [
      item("Check ranking changes and write the notes", 3),
      item("Fix the critical issues from the latest audit", 10, "HIGH"),
      item("Review new and lost backlinks", 14),
      item("Update or improve one page that is losing traffic", 21),
      item("Send the monthly report and talk it through with the client", 28, "HIGH"),
    ],
  },
  {
    key: "technical",
    name: "Technical SEO clean-up",
    items: [
      item("Fix broken links and redirect chains", 7, "HIGH"),
      item("Add missing page titles and descriptions", 10),
      item("Check the robots.txt file and the sitemap", 12),
      item("Improve page speed on the slowest pages", 21),
    ],
  },
];

export type TemplateParse = { items: TemplateItem[]; errors: string[] };

/**
 * Reads a template written as one task a line: `Title | days | priority`. Days (0 to 365) and
 * priority (low, medium, high, urgent) are optional; the default is 7 days and medium.
 */
export function parseTemplateLines(text: string): TemplateParse {
  const items: TemplateItem[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const [title = "", daysText, priorityText] = line.split("|").map((p) => p.trim());
    const row = `Line ${index + 1}`;
    if (title.length < 3 || title.length > 200) {
      errors.push(`${row}: the title needs 3 to 200 characters.`);
      return;
    }
    let days = 7;
    if (daysText) {
      if (!/^\d{1,3}$/.test(daysText) || Number(daysText) > 365) {
        errors.push(`${row}: days must be a number from 0 to 365.`);
        return;
      }
      days = Number(daysText);
    }
    let priority: TaskPriority = "MEDIUM";
    if (priorityText) {
      const found = TASK_PRIORITIES.find((p) => p.key.toLowerCase() === priorityText.toLowerCase());
      if (!found) {
        errors.push(`${row}: priority must be low, medium, high or urgent.`);
        return;
      }
      priority = found.key;
    }
    items.push({ title, description: "", priority, days, estimateMinutes: null });
  });
  if (items.length === 0 && errors.length === 0) errors.push("Write at least one task.");
  if (items.length > 50) errors.push("Use 50 tasks or fewer.");
  return { items, errors };
}

/** Due day of a template task: the start day plus its days. */
export const templateDueDay = (startOn: string, days: number) => addDays(startOn, days);

/** Share of finished tasks, in whole percent. A milestone with no tasks has no percent. */
export function progressPercent(done: number, total: number): number | null {
  return total === 0 ? null : Math.round((done / total) * 100);
}
