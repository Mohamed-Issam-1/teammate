"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";

import { authClient } from "../client";
import { getAuthErrorMessage } from "../errors";
import {
  AUTH_PASSWORD_MAX_LENGTH,
  createZodResolver,
  resetPasswordSchema,
  type ResetPasswordValues,
} from "../validation";
import { AuthFormField } from "./form-field";
import { FormAlert } from "./form-alert";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: createZodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (!submitted) {
      return;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, [submitted]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);

    try {
      const result = await authClient.resetPassword({
        token,
        newPassword: values.newPassword,
      });

      if (result.error || !result.data || result.data.status !== true) {
        setServerError(getAuthErrorMessage(result.error, "reset-password"));
        return;
      }

      setSubmitted(true);
    } catch (error) {
      setServerError(getAuthErrorMessage(error, "reset-password"));
    }
  });

  if (submitted) {
    return (
      <div className="grid gap-4">
        <FormAlert tone="success">
          Your password has been reset. Sign in with your new password.
        </FormAlert>
        <Button asChild className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-5" method="post" noValidate onSubmit={onSubmit}>
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

      <AuthFormField
        id="new-password"
        label="New password"
        registration={register("newPassword")}
        error={errors.newPassword?.message}
        type="password"
        autoComplete="new-password"
        maxLength={AUTH_PASSWORD_MAX_LENGTH}
        description={`Use 8 to ${AUTH_PASSWORD_MAX_LENGTH} characters. Resetting signs out existing sessions.`}
        descriptionId="reset-password-policy"
      />
      <AuthFormField
        id="confirm-password"
        label="Confirm new password"
        registration={register("confirmPassword")}
        error={errors.confirmPassword?.message}
        type="password"
        autoComplete="new-password"
        maxLength={AUTH_PASSWORD_MAX_LENGTH}
      />

      <Button
        type="submit"
        className="h-9 w-full"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? "Resetting password…" : "Reset password"}
      </Button>
    </form>
  );
}
