"use client";

import { Button } from "@/components/ui/button";

/** Used by `error.tsx` files: a plain message and a retry button. */
export function ErrorState({ reset }: { reset: () => void }) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center"
    >
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        We could not show this page. Please try again. If it keeps happening, contact support.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
