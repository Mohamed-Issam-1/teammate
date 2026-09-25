"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { AuthFormField } from "@/features/auth/components/form-field";
import { FormAlert } from "@/features/auth/components/form-alert";
import { createZodResolver } from "@/features/auth/validation";
import {
  completeOnboardingAction,
  type CompleteOnboardingActionData,
} from "@/features/onboarding/actions";
import {
  ONBOARDING_DISPLAY_NAME_MAX_LENGTH,
  onboardingInputSchema,
  type OnboardingInput,
} from "@/features/onboarding/validation";

const GENERIC_ERROR =
  "We couldn't complete onboarding right now. Please try again in a moment.";

type OnboardingFormProps = {
  initialDisplayName: string;
};

function getActionErrorMessage(
  result: ActionResult<CompleteOnboardingActionData>,
): string {
  if (result.ok) {
    return GENERIC_ERROR;
  }

  if (result.code === "UNAUTHENTICATED") {
    return "Your session has expired. Sign in again to continue.";
  }

  if (result.code === "FORBIDDEN") {
    return "Verify your email before completing onboarding.";
  }

  return GENERIC_ERROR;
}

export function OnboardingForm({ initialDisplayName }: OnboardingFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingInput>({
    resolver: createZodResolver(onboardingInputSchema),
    defaultValues: {
      displayName: initialDisplayName,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);

    try {
      const result = await completeOnboardingAction({
        displayName: values.displayName,
      });

      if (!result.ok) {
        const fieldError = result.fieldErrors?.displayName?.[0];
        if (fieldError) {
          setError("displayName", {
            type: "server",
            message: fieldError,
          });
          return;
        }

        setServerError(getActionErrorMessage(result));
        return;
      }

      router.replace("/app");
    } catch {
      setServerError(GENERIC_ERROR);
    }
  });

  return (
    <form className="grid gap-5" method="post" noValidate onSubmit={onSubmit}>
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

      <AuthFormField
        id="display-name"
        label="Display name"
        registration={register("displayName")}
        error={errors.displayName?.message}
        type="text"
        autoComplete="name"
        maxLength={ONBOARDING_DISPLAY_NAME_MAX_LENGTH}
      />

      <Button
        type="submit"
        className="h-9 w-full"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? "Saving your name…" : "Continue to TeamMate"}
      </Button>
    </form>
  );
}
