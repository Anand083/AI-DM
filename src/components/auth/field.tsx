import type { InputHTMLAttributes, Ref } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Field({
  id,
  label,
  error,
  inputRef,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={inputRef}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({
  kind,
  children,
}: {
  kind: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        kind === "error"
          ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          : "rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-300"
      }
    >
      {children}
    </p>
  );
}
