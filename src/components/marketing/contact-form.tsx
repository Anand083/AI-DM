"use client";

import { useState } from "react";
import { sendContactMessageAction } from "@/app/(marketing)/contact/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const result = await sendContactMessageAction({ name, email, message, company });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setErrors(result.fieldErrors ?? {});
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p
        role="status"
        className="rounded-md bg-green-50 px-3 py-2 text-green-800 dark:bg-green-950 dark:text-green-300"
      >
        Thank you. We got your message and will reply by email soon.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4" noValidate aria-label="Contact us">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id="contact-name"
        label="Your name"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <Field
        id="contact-email"
        label="Your email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <div className="space-y-1.5">
        <Label htmlFor="contact-message">How can we help?</Label>
        <Textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "contact-message-error" : undefined}
        />
        {errors.message ? (
          <p
            id="contact-message-error"
            role="alert"
            className="text-sm text-red-600 dark:text-red-400"
          >
            {errors.message}
          </p>
        ) : null}
      </div>
      {/* Hidden from people. Bots that fill every field give themselves away. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company
          <input
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Sending..." : "Send message"}
      </Button>
    </form>
  );
}
