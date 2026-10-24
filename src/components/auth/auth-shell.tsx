import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Card>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </Card>
        {footer ? (
          <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">{footer}</p>
        ) : null}
      </div>
    </main>
  );
}
