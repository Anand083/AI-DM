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
