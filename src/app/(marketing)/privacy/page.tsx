import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p
        role="note"
        className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        This is a placeholder. Replace it with your real privacy policy, written or checked by a
        lawyer, before you open the service to the public.
      </p>
      <h2 className="text-xl font-semibold">What we keep</h2>
      <p>
        We keep the details you give us (such as your name, email and agency) and the data your
        account creates (such as clients, keywords and reports).
      </p>
      <h2 className="text-xl font-semibold">How we use it</h2>
      <p>
        We use your data only to run the service for you. We do not sell it. You can download your
        data or delete your agency at any time from the settings page.
      </p>
      <h2 className="text-xl font-semibold">Contact</h2>
      <p>Questions about privacy? Use the contact page.</p>
    </div>
  );
}
