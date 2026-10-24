import { hashString } from "@/lib/hash";

export type SchedulableProject = {
  id: string;
  rankCheckFrequency: "DAILY" | "WEEKLY";
  rankCheckHourUtc: number;
};

/** Minute of the hour (0 to 59) when a project's check starts. Spreads projects across the hour. */
export function minuteOffset(projectId: string): number {
  return hashString(`minute:${projectId}`) % 60;
}

/** Weekday (0 = Sunday) a weekly project is checked on. */
export function weeklyDay(projectId: string): number {
  return hashString(`weekday:${projectId}`) % 7;
}

/**
 * Is this project's rank check due at `now`? A project is due once its scheduled time today has
 * passed. The scheduler runs every 15 minutes, and the job id (`rank:<project>:<date>`) makes
 * sure a project is only queued once per day, so a missed tick is caught up on the next one.
 */
export function isRankCheckDue(project: SchedulableProject, now: Date): boolean {
  if (project.rankCheckFrequency === "WEEKLY" && now.getUTCDay() !== weeklyDay(project.id))
    return false;
  const minutesIntoDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const scheduled = project.rankCheckHourUtc * 60 + minuteOffset(project.id);
  return minutesIntoDay >= scheduled;
}
