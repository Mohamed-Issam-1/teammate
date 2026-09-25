"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";

import { authClient } from "../client";
import { getAuthErrorMessage, isAuthRateLimitError } from "../errors";
import {
  AUTH_EMAIL_MAX_LENGTH,
  createZodResolver,
  emailOnlySchema,
  type EmailOnlyValues,
} from "../validation";
import { AuthFormField } from "./form-field";
import { FormAlert } from "./form-alert";

const RESET_REQUEST_MESSAGE =
  "If an account matches that email, password reset instructions are on the way. Check your inbox and spam folder.";

export function ForgotPasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailOnlyValues>({
    resolver: createZodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);

    try {
      const result = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: "/reset-password",
      });

      if (result.error) {
        if (isAuthRateLimitError(result.error)) {
          setServerError(getAuthErrorMessage(result.error, "forgot-password"));
          return;
        }

        // Delivery failures can occur only for a matching account. Preserve the
        // same public response for every email so this UI cannot become an
        // account-existence oracle.
        setSubmitted(true);
        return;
      }

      setSubmitted(true);
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        setServerError(getAuthErrorMessage(error, "forgot-password"));
        return;
      }

      setSubmitted(true);
    }
  });

  if (submitted) {
    return (
      <div className="grid gap-4">
        <FormAlert tone="success">{RESET_REQUEST_MESSAGE}</FormAlert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Return to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-5" method="post" noValidate onSubmit={onSubmit}>
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

      <AuthFormField
        id="email"
        label="Email address"
        registration={register("email")}
        error={errors.email?.message}
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={AUTH_EMAIL_MAX_LENGTH}
      />

      <Button
        type="submit"
        className="h-9 w-full"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? "Sending request…" : "Send reset instructions"}
      </Button>

      <Link
        href="/sign-in"
        className="text-muted-foreground focus-visible:ring-ring hover:text-foreground mx-auto w-fit rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
      >
        Return to sign in
      </Link>
    </form>
  );
}
