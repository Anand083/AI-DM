"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { importKeywordsAction } from "@/app/app/[agencySlug]/projects/[projectId]/rankings/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

type Summary = {
  added: number;
  updated: number;
  problems: { line: number; message: string }[];
  truncated: boolean;
};

/** Import keywords from a CSV file or pasted CSV text (columns keyword, tags, url). */
export function ImportKeywordsForm({
  agencySlug,
  projectId,
}: {
  agencySlug: string;
  projectId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("That file is too big. Use a file under 1 MB.");
      return;
    }
    setError(null);
    setCsv(await file.text());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSummary(null);
    const result = await importKeywordsAction(agencySlug, projectId, { csv });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.["values.csv"] ?? result.fieldErrors?.csv ?? result.error);
      return;
    }
    setSummary(result.data);
    toast("success", `Imported: ${result.data.added} new, ${result.data.updated} updated.`);
    setCsv("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="import-file">CSV file</Label>
        <input
          id="import-file"
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={readFile}
          className="block text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="import-csv">Or paste CSV text</Label>
        <Textarea
          id="import-csv"
          value={csv}
          rows={5}
          placeholder={"keyword,tags,url\nrunning shoes,brand;local,https://example.com/shoes"}
          onChange={(e) => setCsv(e.target.value)}
        />
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Columns: keyword, tags (separate with ;) and url. The first row may name the columns.
          Keywords you already track get the tags and url from the file.
        </p>
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={busy || csv.trim() === ""}>
        Import
      </Button>
      {summary ? (
        <div role="status" className="space-y-1 text-sm">
          <p>
            Added {summary.added}, updated {summary.updated}.
            {summary.truncated ? " Only the first 5000 lines were read." : ""}
          </p>
          {summary.problems.length > 0 ? (
            <ul aria-label="Import problems" className="list-disc pl-5">
              {summary.problems.map((p) => (
                <li key={`${p.line}-${p.message}`}>
                  Line {p.line}: {p.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
