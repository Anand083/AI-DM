import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 text-sm placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:focus-visible:outline-zinc-100",
        className,
      )}
      {...props}
    />
  );
}
