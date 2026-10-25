"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { loginSchema, type LoginValues } from "@/lib/auth-schemas";
import { zodResolver } from "@/lib/form";

export function LoginForm({
  next,
  notice,
  forgotHref = "/forgot-password",
}: {
  next: string;
  notice?: string;
  /** Where "forgot password" goes. Pass null to hide it (the client portal has no platform pages). */
  forgotHref?: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(
    notice ? { kind: "success", text: notice } : null,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    setMessage(null);
    const { error } = await authClient.signIn.email({ ...values, callbackURL: next });
    if (!error) {
      router.push(next);
      router.refresh();
      return;
    }
    if (error.status === 403) {
      setMessage({
        kind: "error",
        text: "Please confirm your email first. We sent you a new link.",
      });
    } else if (error.status === 429) {
      setMessage({
        kind: "error",
        text: "Too many attempts. Please wait a few minutes and try again.",
      });
    } else {
      setMessage({ kind: "error", text: "Wrong email or password." });
    }
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
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      {forgotHref ? (
        <div className="text-right text-sm">
          <Link href={forgotHref} className="underline">
            Forgot your password?
          </Link>
        </div>
      ) : null}
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
