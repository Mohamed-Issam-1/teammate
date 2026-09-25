import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/components/auth-card";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a TeamMate account and verify your email address.",
};

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Start with your name and email. We will verify your address before you sign in."
    >
      <SignUpForm />
    </AuthCard>
  );
}
