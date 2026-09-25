"use client";

import { useEffect, useState } from "react";
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
import {
  clearVerificationEmailPrefill,
  readVerificationEmailPrefill,
} from "../verification-email";
import { AuthFormField } from "./form-field";
import { FormAlert } from "./form-alert";

const RESEND_MESSAGE =
  "If an account matches that email and still needs verification, a new link is on the way. Check your inbox and spam folder.";

export function VerificationResendForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EmailOnlyValues>({
    resolver: createZodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    const savedEmail = readVerificationEmailPrefill();
    if (savedEmail) {
      reset({ email: savedEmail });
    }
  }, [reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);

    try {
      const result = await authClient.sendVerificationEmail({
        email: values.email,
        callbackURL: "/verify-email?verified=1",
      });

      if (result.error) {
        if (isAuthRateLimitError(result.error)) {
          setServerError(getAuthErrorMessage(result.error, "verification"));
          return;
        }

        // A provider failure can be account-specific. Return neutral copy so
        // verification resend cannot reveal whether an account exists.
        clearVerificationEmailPrefill();
        setSubmitted(true);
        return;
      }

      clearVerificationEmailPrefill();
      setSubmitted(true);
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        setServerError(getAuthErrorMessage(error, "verification"));
        return;
      }

      clearVerificationEmailPrefill();
      setSubmitted(true);
    }
  });

  if (submitted) {
    return <FormAlert tone="success">{RESEND_MESSAGE}</FormAlert>;
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
        {isSubmitting ? "Sending…" : "Send verification email"}
      </Button>
    </form>
  );
}
