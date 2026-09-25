import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/25 flex min-h-full flex-1 flex-col">
      <header className="border-border bg-background border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="text-foreground focus-visible:ring-ring rounded-sm text-sm font-semibold tracking-tight focus-visible:ring-2 focus-visible:outline-none"
          >
            TeamMate
          </Link>
          <span className="text-muted-foreground text-xs">
            Secure account access
          </span>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
