"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { signupSchema, type SignupValues } from "@/lib/auth-schemas";
import { zodResolver } from "@/lib/form";

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({ resolver: zodResolver(signupSchema) });

  async function onSubmit(values: SignupValues) {
    setError(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const { error: signUpError } = await authClient.signUp.email({
      ...values,
      timezone,
      callbackURL: "/app",
    });
    if (!signUpError) {
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
      return;
    }
    if (signUpError.status === 429) {
      setError("Too many attempts. Please wait a few minutes and try again.");
    } else {
      setError(signUpError.message ?? "We could not create your account. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id="name"
        label="Your name"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />
      <Field
        id="email"
        label="Work email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Use at least 10 characters.</p>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
