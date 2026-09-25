import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request password reset instructions for your TeamMate account.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email address and we will send reset instructions if an account matches."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
