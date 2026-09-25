import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import { getCurrentOnboardingState } from "@/server/profiles/current-onboarding";

export const metadata: Metadata = {
  title: "Account",
  description: "Your TeamMate account is ready.",
};

export default async function AppPage() {
  let state: Awaited<ReturnType<typeof getCurrentOnboardingState>>;

  try {
    state = await getCurrentOnboardingState();
  } catch (error) {
    if (error instanceof EmailVerificationRequiredError) {
      redirect("/verify-email");
    }

    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }

    throw error;
  }

  if (!state.onboardingComplete) {
    redirect("/onboarding");
  }

  return (
    <div className="bg-muted/25 flex min-h-full flex-1 flex-col">
      <header className="border-border bg-background border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-4 sm:px-6">
          <span className="text-foreground text-sm font-semibold tracking-tight">
            TeamMate
          </span>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
        <Card className="w-full max-w-lg shadow-sm">
          <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
            <p className="text-muted-foreground text-sm font-medium">
              Account ready
            </p>
            <h1 className="text-foreground mt-2 text-2xl font-semibold tracking-tight text-balance">
              Welcome, {state.displayName}
            </h1>
          </CardHeader>
          <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your TeamMate account is ready.
            </p>
            <SignOutButton />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
