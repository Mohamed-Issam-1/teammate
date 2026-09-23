import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-foreground mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        Page not found
      </h1>
      <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed">
        The page you are looking for does not exist or may have moved.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to the TeamMate home page</Link>
      </Button>
    </main>
  );
}
