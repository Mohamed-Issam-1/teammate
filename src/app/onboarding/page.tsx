import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import { requireServerSession } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Account setup",
  description: "Continue setting up your TeamMate account.",
};

export default async function OnboardingPage() {
  try {
    await requireServerSession();
  } catch (error) {
    if (error instanceof EmailVerificationRequiredError) {
      redirect("/verify-email");
    }

    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }

    throw error;
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
              Account setup
            </p>
            <h1 className="text-foreground mt-2 text-2xl font-semibold tracking-tight text-balance">
              Your account is ready
            </h1>
          </CardHeader>
          <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your email is verified. Profile and account setup will continue in
              this protected area in the next step.
            </p>
            <SignOutButton />
            <Button asChild variant="outline" className="mt-6 w-full">
              <Link href="/">Return to the home page</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
