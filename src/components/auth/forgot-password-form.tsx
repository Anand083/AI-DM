"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/auth-schemas";
import { zodResolver } from "@/lib/form";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordValues) {
    setMessage(null);
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: "/reset-password",
    });
    if (error?.status === 429) {
      setMessage({
        kind: "error",
        text: "Too many attempts. Please wait a few minutes and try again.",
      });
      return;
    }
    // Same answer whether or not the email exists, so nobody can probe for accounts.
    setMessage({
      kind: "success",
      text: "If an account exists for that email, we sent a link to reset your password.",
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Sending..." : "Send reset link"}
      </Button>
    </form>
  );
}
