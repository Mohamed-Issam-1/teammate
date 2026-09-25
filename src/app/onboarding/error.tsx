"use client";

import { Button } from "@/components/ui/button";

export default function OnboardingError({ reset }: { reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Account setup is temporarily unavailable
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          We couldn&apos;t load your account setup right now. Please try again
          in a moment.
        </p>
        <Button className="mt-6" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
