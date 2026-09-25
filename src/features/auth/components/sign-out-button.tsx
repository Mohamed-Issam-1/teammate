"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { authClient } from "../client";
import { getAuthErrorMessage } from "../errors";
import { FormAlert } from "./form-alert";

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setError(null);
    setIsPending(true);

    try {
      const result = await authClient.signOut();

      if (result.error || !result.data || result.data.success !== true) {
        setError(getAuthErrorMessage(result.error, "sign-out"));
        return;
      }

      router.replace("/sign-in");
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError, "sign-out"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="mt-6 grid gap-3">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleSignOut}
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? "Signing out…" : "Sign out"}
      </Button>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
    </div>
  );
}
