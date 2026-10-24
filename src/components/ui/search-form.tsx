import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A plain GET form, so search works without JavaScript and results are shareable links. */
export function SearchForm({
  label,
  placeholder,
  q,
  hidden = {},
  children,
}: {
  label: string;
  placeholder: string;
  q?: string;
  hidden?: Record<string, string | undefined>;
  children?: ReactNode;
}) {
  return (
    <form role="search" method="get" className="flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <div>
        <label htmlFor="q" className="sr-only">
          {label}
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={placeholder}
          className="w-64 max-w-full"
        />
      </div>
      {children}
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}
