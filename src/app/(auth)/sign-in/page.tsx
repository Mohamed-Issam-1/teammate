import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/components/auth-card";
import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your verified TeamMate account.",
};

export default function SignInPage() {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in with your verified email address and password."
    >
      <SignInForm />
    </AuthCard>
  );
}
