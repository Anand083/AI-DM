"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { submitLeadAction } from "@/app/widget/[agencySlug]/actions";
import { initials } from "@/lib/brand";
import type { LeadIssue } from "@/lib/lead-widget";
import { scoreBand } from "@/lib/audit-math";

type Result =
  | { status: "QUEUED" | "RUNNING" }
  | { status: "FAILED"; message: string }
  | { status: "DONE"; healthScore: number; pagesCrawled: number; issues: LeadIssue[] };

const POLL_MS = 3000;
const GIVE_UP_AFTER_POLLS = 80;
const SEVERITY_TEXT = { CRITICAL: "Serious", WARNING: "Should fix", NOTICE: "Small" } as const;
const BAND_TEXT = { good: "Good", fair: "Needs work", poor: "Needs attention" } as const;

const inputClass =
  "h-11 w-full rounded-md border border-zinc-400 bg-white px-3 text-sm text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900";

const noopSubscribe = () => () => {};

/** False while the page is built on the server and until React has taken over in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * The free website check shown in a frame on an agency's site. The visitor enters a website and an
 * email, waits a little, and sees a score and the main problems. Only the agency gets the email.
 */
export function LeadWidget({
  agencySlug,
  displayName,
  hasLogo,
  logoVersion,
  contactEmail,
  contactWebsite,
}: {
  agencySlug: string;
  displayName: string;
  hasLogo: boolean;
  logoVersion: string | null;
  contactEmail: string | null;
  contactWebsite: string | null;
}) {
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [publicId, setPublicId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // The button stays off until the form can be handled by our code, so nothing is ever sent as a
  // plain page request (which would put the email in the address).
  const hydrated = useHydrated();

  // Tell the page that holds the frame how tall the widget is.
  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return;
    const send = () =>
      window.parent.postMessage({ type: "lead-widget-height", height: el.scrollHeight + 24 }, "*");
    send();
    const observer = new ResizeObserver(send);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Ask for the result every few seconds until it is there.
  useEffect(() => {
    if (!publicId) return;
    let polls = 0;
    let stopped = false;
    const timer = setInterval(async () => {
      polls += 1;
      if (polls > GIVE_UP_AFTER_POLLS) {
        clearInterval(timer);
        setResult({
          status: "FAILED",
          message: "This is taking too long. Please try again later.",
        });
        return;
      }
      try {
        const response = await fetch(`/api/widget/lead/${encodeURIComponent(publicId)}`, {
          cache: "no-store",
        });
        if (stopped) return;
        if (response.status === 404) {
          clearInterval(timer);
          setResult({
            status: "FAILED",
            message: "We could not find this check. Please try again.",
          });
          return;
        }
        if (!response.ok) return;
        const next = (await response.json()) as Result;
        setResult(next);
        if (next.status === "DONE" || next.status === "FAILED") clearInterval(timer);
      } catch {
        // A short network problem: try again at the next tick.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [publicId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const response = await submitLeadAction(agencySlug, { website, email, company: trap });
    setBusy(false);
    if (!response.ok) {
      setFieldErrors(response.fieldErrors ?? {});
      setError(response.error);
      return;
    }
    if (!response.publicId) {
      // A bot trap: look like it worked, show nothing real.
      setResult({ status: "FAILED", message: "We could not check this website right now." });
      return;
    }
    setResult({ status: "QUEUED" });
    setPublicId(response.publicId);
  }

  const working = result?.status === "QUEUED" || result?.status === "RUNNING";
  const done = result?.status === "DONE" ? result : null;
  const band = done ? scoreBand(done.healthScore) : null;
  const contact = contactEmail ? `mailto:${contactEmail}` : contactWebsite;

  return (
    <div ref={root} className="mx-auto max-w-xl p-4">
      <div className="flex items-center gap-3">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- the agency's own public logo route
          <img
            src={`/portal/${agencySlug}/logo?v=${logoVersion ?? "1"}`}
            alt=""
            className="size-10 rounded object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-full text-sm font-semibold"
            style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
          >
            {initials(displayName)}
          </span>
        )}
        <div>
          <h1 className="text-lg font-semibold">Free website check</h1>
          <p className="text-sm text-zinc-700">by {displayName}</p>
        </div>
      </div>

      {!result ? (
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <p className="text-sm text-zinc-700">
            See how healthy your website is for search engines. It takes about a minute.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="w-site" className="text-sm font-medium">
              Your website
            </label>
            <input
              id="w-site"
              className={inputClass}
              placeholder="example.com"
              autoComplete="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              aria-invalid={fieldErrors.website ? true : undefined}
              aria-describedby={fieldErrors.website ? "w-site-error" : undefined}
            />
            {fieldErrors.website ? (
              <p id="w-site-error" role="alert" className="text-sm text-red-700">
                {fieldErrors.website}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="w-email" className="text-sm font-medium">
              Your email
            </label>
            <input
              id="w-email"
              type="email"
              className={inputClass}
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "w-email-error" : undefined}
            />
            {fieldErrors.email ? (
              <p id="w-email-error" role="alert" className="text-sm text-red-700">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>
          {/* A trap for simple bots. People never see it and never fill it in. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}>
            <label htmlFor="w-company">Company</label>
            <input
              id="w-company"
              tabIndex={-1}
              autoComplete="off"
              value={trap}
              onChange={(e) => setTrap(e.target.value)}
            />
          </div>
          {error && Object.keys(fieldErrors).length === 0 ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !hydrated}
            className="h-11 rounded-md px-5 text-sm font-semibold disabled:opacity-60"
            style={{ background: "var(--brand-primary)", color: "var(--brand-primary-text)" }}
          >
            {busy ? "Sending..." : "Check my website"}
          </button>
          <p className="text-xs text-zinc-600">
            {displayName} will see your email and may contact you about your website.
          </p>
        </form>
      ) : null}

      {working ? (
        <p role="status" className="mt-6 text-sm">
          Checking your website. This takes about a minute. Please keep this page open.
        </p>
      ) : null}

      {result?.status === "FAILED" ? (
        <div className="mt-6 space-y-3">
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {result.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setPublicId(null);
            }}
            className="text-sm underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      ) : null}

      {done && band ? (
        <div className="mt-6 space-y-4" aria-live="polite">
          <div className="flex items-center gap-4">
            <div
              className="flex size-20 items-center justify-center rounded-full border-4 text-2xl font-semibold tabular-nums"
              style={{ borderColor: "var(--brand-accent)" }}
            >
              <span aria-label={`Health score ${done.healthScore} out of 100`}>
                {done.healthScore}
              </span>
            </div>
            <div>
              <p className="font-semibold">{BAND_TEXT[band]}</p>
              <p className="text-sm text-zinc-700">
                Health score out of 100, from {done.pagesCrawled}{" "}
                {done.pagesCrawled === 1 ? "page" : "pages"} checked.
              </p>
            </div>
          </div>
          {done.issues.length > 0 ? (
            <div>
              <h2 className="text-base font-semibold">What to fix first</h2>
              <ul className="mt-2 space-y-3">
                {done.issues.map((issue) => (
                  <li key={issue.code} className="rounded-lg border border-zinc-300 p-3 text-sm">
                    <p className="font-medium">
                      {issue.title}{" "}
                      <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium">
                        {SEVERITY_TEXT[issue.severity]}
                      </span>
                    </p>
                    <p className="mt-1 text-zinc-700">{issue.fix}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm">We did not find any problems on the pages we checked.</p>
          )}
          {contact ? (
            <p className="text-sm">
              Want help fixing these?{" "}
              <a
                href={contact}
                className="font-medium underline underline-offset-4"
                target="_blank"
                rel="noreferrer"
              >
                Contact {displayName}
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
