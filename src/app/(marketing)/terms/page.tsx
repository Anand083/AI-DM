import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of service</h1>
      <p
        role="note"
        className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        This is a placeholder. Replace it with your real terms, written or checked by a lawyer,
        before you open the service to the public.
      </p>
      <h2 className="text-xl font-semibold">Using the service</h2>
      <p>
        You may use the service for your own agency and your clients. You are responsible for what
        you do with it and for keeping your login safe.
      </p>
      <h2 className="text-xl font-semibold">Payments and cancelling</h2>
      <p>
        Paid plans renew each month or year until you cancel. You can cancel at any time and keep
        access until the end of the period you paid for.
      </p>
      <h2 className="text-xl font-semibold">Changes</h2>
      <p>We may update these terms. We will tell you about important changes.</p>
    </div>
  );
}
