"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Toast = { id: number; kind: "success" | "error"; text: string };
type ToastApi = { toast: (kind: Toast["kind"], text: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

/** Small messages that appear in the corner and disappear after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, kind, text }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={
              t.kind === "error"
                ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow dark:border-red-900 dark:bg-red-950 dark:text-red-100"
                : "rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 shadow dark:border-green-900 dark:bg-green-950 dark:text-green-100"
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}
