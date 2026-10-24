"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { resetPasswordSchema, type ResetPasswordValues } from "@/lib/auth-schemas";
import { zodResolver } from "@/lib/form";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) });

  async function onSubmit(values: ResetPasswordValues) {
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: values.password,
      token,
    });
    if (resetError) {
      setError("This link is not valid or has expired. Please ask for a new one.");
      return;
    }
    router.push("/login?reset=1");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Field
        id="confirm"
        label="Repeat new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register("confirm")}
      />
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save new password"}
      </Button>
    </form>
  );
}
