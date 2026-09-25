"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import { requireServerSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  completeOnboardingForSession,
  InvalidOnboardingInputError,
} from "@/server/profiles/onboarding";

import { onboardingInputSchema } from "./validation";

const INTERNAL_ERROR_MESSAGE =
  "We couldn't complete onboarding right now. Please try again in a moment.";

export type CompleteOnboardingActionData = {
  alreadyCompleted: boolean;
};

export async function completeOnboardingAction(
  input: unknown,
): Promise<ActionResult<CompleteOnboardingActionData>> {
  let session: Awaited<ReturnType<typeof requireServerSession>>;

  try {
    session = await requireServerSession();
  } catch (error) {
    if (error instanceof EmailVerificationRequiredError) {
      return fail(
        "FORBIDDEN",
        "Verify your email before completing onboarding.",
      );
    }

    if (error instanceof AuthenticationRequiredError) {
      return fail("UNAUTHENTICATED", "Sign in to complete onboarding.");
    }

    return fail("INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE);
  }

  const parsedInput = onboardingInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return fail(
      "VALIDATION_ERROR",
      "Enter a display name between 2 and 80 characters.",
      {
        displayName: ["Enter a display name between 2 and 80 characters."],
      },
    );
  }

  try {
    const result = await completeOnboardingForSession(
      session,
      parsedInput.data,
      prisma,
    );

    revalidatePath("/onboarding");
    revalidatePath("/app");

    return ok({ alreadyCompleted: !result.completedNow });
  } catch (error) {
    if (error instanceof EmailVerificationRequiredError) {
      return fail(
        "FORBIDDEN",
        "Verify your email before completing onboarding.",
      );
    }

    if (error instanceof AuthenticationRequiredError) {
      return fail("UNAUTHENTICATED", "Sign in to complete onboarding.");
    }

    if (error instanceof InvalidOnboardingInputError) {
      return fail(
        "VALIDATION_ERROR",
        "Enter a display name between 2 and 80 characters.",
        {
          displayName: ["Enter a display name between 2 and 80 characters."],
        },
      );
    }

    return fail("INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE);
  }
}
