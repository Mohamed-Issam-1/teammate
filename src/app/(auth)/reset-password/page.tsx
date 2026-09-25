import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/components/auth-card";
import { FormAlert } from "@/features/auth/components/form-alert";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { getAuthErrorMessage } from "@/features/auth/errors";
import {
  getSingleSearchParam,
  hasUsableResetToken,
} from "@/features/auth/validation";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Choose a new password for your TeamMate account.",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string | string[];
    error?: string | string[];
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = getSingleSearchParam(params.token);
  const errorCode = getSingleSearchParam(params.error);

  if (!hasUsableResetToken(token) || errorCode) {
    const message = errorCode
      ? getAuthErrorMessage({ code: errorCode }, "reset-password")
      : "This password reset link is missing its secure token. Request a new reset link to continue.";

    return (
      <AuthCard
        title="Reset link unavailable"
        description="For your security, every reset link must be complete and valid."
      >
        <div className="grid gap-4">
          <FormAlert tone="error">{message}</FormAlert>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new reset link</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Use the secure link from your email to set a new password for your account."
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
