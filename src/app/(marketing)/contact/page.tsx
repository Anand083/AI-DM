import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Ask a question or tell us what you need.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Ask a question or tell us what you need. We reply by email.
        </p>
      </div>
      <ContactForm />
    </div>
  );
}
