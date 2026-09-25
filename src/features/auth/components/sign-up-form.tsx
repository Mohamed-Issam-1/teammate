"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";

import { authClient } from "../client";
import { getAuthErrorMessage } from "../errors";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  createZodResolver,
  signUpSchema,
  type SignUpValues,
} from "../validation";
import { saveVerificationEmailPrefill } from "../verification-email";
import { AuthFormField } from "./form-field";
import { FormAlert } from "./form-alert";

const VERIFICATION_REQUIRED_MESSAGE =
  "Check your email for a verification link. If an account matches, the next step is to verify it.";

export function SignUpForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: createZodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);

    try {
      const result = await authClient.signUp.email({
        name: values.name,
        email: values.email,
        password: values.password,
        callbackURL: "/verify-email?verified=1",
      });

      if (result.error || !result.data) {
        setServerError(getAuthErrorMessage(result.error, "sign-up"));
        return;
      }

      saveVerificationEmailPrefill(values.email);
      setVerificationRequired(true);
      router.replace("/verify-email");
    } catch (error) {
      setServerError(getAuthErrorMessage(error, "sign-up"));
    }
  });

  if (verificationRequired) {
    return (
      <div className="grid gap-4">
        <FormAlert tone="success">{VERIFICATION_REQUIRED_MESSAGE}</FormAlert>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Verification does not sign you in. Confirm your address, then return
          to sign in.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-5" method="post" noValidate onSubmit={onSubmit}>
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

      <AuthFormField
        id="name"
        label="Full name"
        registration={register("name")}
        error={errors.name?.message}
        type="text"
        autoComplete="name"
        maxLength={80}
      />
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
        autoComplete="new-password"
        maxLength={AUTH_PASSWORD_MAX_LENGTH}
        description={`Use 8 to ${AUTH_PASSWORD_MAX_LENGTH} characters.`}
        descriptionId="sign-up-password-policy"
      />
      <AuthFormField
        id="confirm-password"
        label="Confirm password"
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
        {isSubmitting ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-foreground focus-visible:ring-ring rounded-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
