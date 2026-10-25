"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** The line to paste into the agency's website, with a copy button. */
export function EmbedCodePanel({ code }: { code: string }) {
  const { toast } = useToast();
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setFailed(false);
      toast("success", "Copied.");
    } catch {
      // No clipboard access (for example an old browser): the text is selected for the person.
      setFailed(true);
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor="embed-code" className="text-sm font-medium">
        Embed code
      </label>
      <textarea
        id="embed-code"
        readOnly
        rows={2}
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-md border border-zinc-300 bg-transparent p-3 font-mono text-xs dark:border-zinc-700"
      />
      <Button type="button" onClick={() => void copy()}>
        Copy embed code
      </Button>
      {failed ? (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          Copying did not work. Select the text above and copy it by hand.
        </p>
      ) : null}
    </div>
  );
}
