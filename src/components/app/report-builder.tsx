"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createReportAction,
  deleteReportTemplateAction,
  saveReportTemplateAction,
} from "@/app/app/[agencySlug]/reports/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_SECTIONS, REPORT_SECTIONS, type ReportSectionKey } from "@/lib/report-model";
import { PERIOD_OPTIONS, type PeriodKind } from "@/lib/report-period";

export function ReportBuilder({
  agencySlug,
  projects,
  defaultProjectId,
  templates = [],
}: {
  agencySlug: string;
  projects: { id: string; name: string; clientName: string }[];
  defaultProjectId?: string;
  templates?: { id: string; name: string; sections: string[]; notes: string | null }[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [period, setPeriod] = useState<PeriodKind>("last30");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [sections, setSections] = useState<Set<ReportSectionKey>>(new Set(DEFAULT_SECTIONS));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSections(
      new Set(
        t.sections.filter((k): k is ReportSectionKey => REPORT_SECTIONS.some((s) => s.key === k)),
      ),
    );
    setNotes(t.notes ?? "");
  }

  async function saveTemplate() {
    setError(null);
    setSaved(null);
    const result = await saveReportTemplateAction(agencySlug, {
      name: templateName,
      sections: REPORT_SECTIONS.map((s) => s.key).filter((key) => sections.has(key)),
      notes: sections.has("notes") && notes ? notes : null,
    });
    if (!result.ok) {
      setError(result.fieldErrors?.name ?? result.error);
      return;
    }
    setSaved(`Saved the template "${templateName}".`);
    setTemplateName("");
    router.refresh();
  }

  async function removeTemplate() {
    const result = await deleteReportTemplateAction(agencySlug, templateId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTemplateId("");
    router.refresh();
  }

  function toggle(key: ReportSectionKey) {
    setSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await createReportAction(agencySlug, {
      projectId,
      title: title || undefined,
      period,
      start: period === "custom" ? start : undefined,
      end: period === "custom" ? end : undefined,
      sections: REPORT_SECTIONS.map((s) => s.key).filter((key) => sections.has(key)),
      notes: sections.has("notes") ? notes || undefined : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/app/${agencySlug}/reports/${result.data.reportId}`);
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <div className="space-y-1.5">
        <Label htmlFor="projectId">Project</Label>
        <Select id="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.clientName})
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="period">Period</Label>
        <Select
          id="period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodKind)}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.kind} value={o.kind}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {period === "custom" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="start"
            label="Start date"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Field
            id="end"
            label="End date"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      ) : null}

      <Field
        id="title"
        label="Title (optional)"
        value={title}
        maxLength={120}
        placeholder="We will write one for you"
        onChange={(e) => setTitle(e.target.value)}
      />

      {templates.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="template">Start from a template</Label>
          <div className="flex gap-2">
            <Select
              id="template"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            {templateId ? (
              <Button type="button" variant="outline" onClick={removeTemplate}>
                Delete template
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sections to include</legend>
        {REPORT_SECTIONS.map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sections.has(s.key)} onChange={() => toggle(s.key)} />
            {s.label}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Field
            id="templateName"
            label="Save these sections as a template"
            value={templateName}
            maxLength={60}
            placeholder="For example: Monthly SEO report"
            onChange={(e) => setTemplateName(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={templateName.trim().length < 2 || sections.size === 0}
          onClick={saveTemplate}
        >
          Save template
        </Button>
      </div>
      {saved ? <FormMessage kind="success">{saved}</FormMessage> : null}

      {sections.has("notes") ? (
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes for your client</Label>
          <Textarea
            id="notes"
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      ) : null}

      <Button type="submit" disabled={busy || !projectId}>
        {busy ? "Creating..." : "Create report"}
      </Button>
    </form>
  );
}
