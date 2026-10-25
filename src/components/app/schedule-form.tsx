"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createScheduleAction } from "@/app/app/[agencySlug]/reports/schedules/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_SECTIONS, REPORT_SECTIONS, type ReportSectionKey } from "@/lib/report-model";
import { WEEKDAYS } from "@/lib/report-schedule";
import { parseRecipients } from "@/lib/schemas/report-schedule";

export function ScheduleForm({
  agencySlug,
  projects,
  timezone,
}: {
  agencySlug: string;
  /** Projects that do not have a schedule yet. */
  projects: { id: string; name: string; clientName: string }[];
  timezone: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [recipients, setRecipients] = useState("");
  const [sections, setSections] = useState<Set<ReportSectionKey>>(
    new Set(DEFAULT_SECTIONS.filter((s) => s !== "rankings")),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (projects.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Every project already has a schedule, or there are no projects yet.
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await createScheduleAction(agencySlug, {
      projectId,
      frequency,
      dayOfWeek,
      dayOfMonth,
      hour,
      recipients: parseRecipients(recipients),
      sections: REPORT_SECTIONS.map((s) => s.key).filter((k) => sections.has(k)),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors ? Object.values(result.fieldErrors)[0]! : result.error);
      return;
    }
    toast("success", "Schedule saved.");
    setRecipients("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4" noValidate aria-label="New schedule">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="space-y-1.5">
        <Label htmlFor="sch-project">Project</Label>
        <Select id="sch-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.clientName})
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="sch-frequency">How often</Label>
          <Select
            id="sch-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as "WEEKLY" | "MONTHLY")}
          >
            <option value="WEEKLY">Every week</option>
            <option value="MONTHLY">Every month</option>
          </Select>
        </div>
        {frequency === "WEEKLY" ? (
          <div className="space-y-1.5">
            <Label htmlFor="sch-day-week">Day</Label>
            <Select
              id="sch-day-week"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="sch-day-month">Day of the month</Label>
            <Select
              id="sch-day-month"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="sch-hour">Time ({timezone})</Label>
          <Select id="sch-hour" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sch-recipients">Send to (email addresses)</Label>
        <Textarea
          id="sch-recipients"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="client@example.com, boss@example.com"
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sections to include</legend>
        {REPORT_SECTIONS.filter((s) => s.key !== "notes").map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sections.has(s.key)}
              onChange={() =>
                setSections((cur) => {
                  const next = new Set(cur);
                  if (next.has(s.key)) next.delete(s.key);
                  else next.add(s.key);
                  return next;
                })
              }
            />
            {s.label}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Weekly reports cover the last 7 days. Monthly reports cover the whole last month.
      </p>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving..." : "Save schedule"}
      </Button>
    </form>
  );
}
