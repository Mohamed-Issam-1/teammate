"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";

import { authClient } from "../client";
import { getAuthErrorMessage, hasAuthErrorCode } from "../errors";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  createZodResolver,
  signInSchema,
  type SignInValues,
} from "../validation";
import { AuthFormField } from "./form-field";
import { FormAlert } from "./form-alert";

export function SignInForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: createZodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setVerificationRequired(false);

    try {
      const result = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });

      if (result.error || !result.data) {
        setServerError(getAuthErrorMessage(result.error, "sign-in"));
        setVerificationRequired(
          hasAuthErrorCode(result.error, "EMAIL_NOT_VERIFIED"),
        );
        return;
      }

      router.replace("/onboarding");
    } catch (error) {
      setServerError(getAuthErrorMessage(error, "sign-in"));
      setVerificationRequired(false);
    }
  });

  return (
    <form className="grid gap-5" method="post" noValidate onSubmit={onSubmit}>
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
      {verificationRequired ? (
        <Link
          href="/verify-email"
          className="text-foreground focus-visible:ring-ring -mt-3 w-fit rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          Verify your email
        </Link>
      ) : null}

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
      <AuthFormField
        id="password"
        label="Password"
        registration={register("password")}
        error={errors.password?.message}
        type="password"
        autoComplete="current-password"
        maxLength={AUTH_PASSWORD_MAX_LENGTH}
      />

      <div className="grid gap-3">
        <Button
          type="submit"
          className="h-9 w-full"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
        <Link
          href="/forgot-password"
          className="text-muted-foreground focus-visible:ring-ring hover:text-foreground mx-auto w-fit rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          Forgot your password?
        </Link>
      </div>

      <p className="text-muted-foreground text-center text-sm">
        New to TeamMate?{" "}
        <Link
          href="/sign-up"
          className="text-foreground focus-visible:ring-ring rounded-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
