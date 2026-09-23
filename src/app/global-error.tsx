"use client";

import "./globals.css";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // This boundary replaces the root layout, so it must render its own
  // <html> and <body>. Never surface error details beyond the digest —
  // messages can contain internal context.
  console.error(error);

  return (
    <html lang="en">
      <body className="bg-background text-foreground flex min-h-full flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed">
          An unexpected error occurred. Try again, or come back later.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Reference: {error.digest}
          </p>
        ) : null}
        <Button className="mt-6" onClick={() => reset()}>
          Try again
        </Button>
      </body>
    </html>
  );
}
