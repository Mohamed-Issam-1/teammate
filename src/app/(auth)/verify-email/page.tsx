import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/components/auth-card";
import { FormAlert } from "@/features/auth/components/form-alert";
import { VerificationResendForm } from "@/features/auth/components/verification-resend-form";
import { getAuthErrorMessage } from "@/features/auth/errors";
import { getSingleSearchParam } from "@/features/auth/validation";

export const metadata: Metadata = {
  title: "Verify email",
  description: "Verify your email address before signing in to TeamMate.",
};

const NEUTRAL_VERIFICATION_MESSAGE =
  "Check your email for a verification link. If an account matches, the next step is to verify it.";

type VerifyEmailPageProps = {
  searchParams: Promise<{
    verified?: string | string[];
    error?: string | string[];
  }>;
};

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams;
  const verified = getSingleSearchParam(params.verified);
  const errorCode = getSingleSearchParam(params.error);

  if (errorCode) {
    return (
      <AuthCard
        title="Verification link unavailable"
        description="The link may be invalid, expired, or already used."
      >
        <div className="grid gap-4">
          <FormAlert tone="error">
            {getAuthErrorMessage({ code: errorCode }, "verification")}
          </FormAlert>
          <Button asChild variant="outline" className="w-full">
            <Link href="/verify-email">Request a new link</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (verified === "1") {
    return (
      <AuthCard
        title="Email verified"
        description="Your email address is confirmed. Verification did not create a session."
      >
        <div className="grid gap-4">
          <FormAlert tone="success">
            Email verification completed successfully.
          </FormAlert>
          <Button asChild className="w-full">
            <Link href="/sign-in">Continue to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Verify your email"
      description="Email verification is required before you can sign in. Verification does not automatically create a session."
    >
      <div className="grid gap-5">
        <FormAlert tone="success">{NEUTRAL_VERIFICATION_MESSAGE}</FormAlert>
        <VerificationResendForm />
        <Link
          href="/sign-in"
          className="text-muted-foreground focus-visible:ring-ring hover:text-foreground mx-auto w-fit rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          Return to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
