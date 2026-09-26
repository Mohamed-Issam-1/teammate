"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  profileEditSchema,
  PROFILE_EDIT_GENERIC_ERROR,
} from "@/features/profile/validation";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import { updateCurrentOwnProfile } from "@/server/profiles/current-profile";
import {
  InvalidProfileInputError,
  ProfileNotOnboardedError,
} from "@/server/profiles/own-profile";

export type UpdateProfileActionData = {
  displayName: string;
};

const ONBOARDING_ERROR = "Finish account setup before editing your profile.";

/**
 * Persist the authenticated user's own editable profile fields.
 *
 * The input is parsed with a strict schema and the user identity is derived from
 * the server session, so no client-supplied identifier or protected field can
 * reach the write. Expected validation problems are reported per field;
 * anything unexpected collapses into one generic message with no Prisma, SQL, or
 * auth detail.
 */
export async function updateProfileAction(
  input: unknown,
): Promise<ActionResult<UpdateProfileActionData>> {
  const parsedInput = profileEditSchema.safeParse(input);

  if (!parsedInput.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsedInput.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        fieldErrors[field] = [issue.message];
      }
    }

    return fail(
      "VALIDATION_ERROR",
      "Check the highlighted fields and try again.",
      Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
    );
  }

  try {
    const profile = await updateCurrentOwnProfile(parsedInput.data);

    revalidatePath("/app");
    revalidatePath("/app/profile");
    revalidatePath("/onboarding");

    return ok({ displayName: profile.displayName });
  } catch (error) {
    if (error instanceof InvalidProfileInputError) {
      return fail(
        "VALIDATION_ERROR",
        "Check the highlighted fields and try again.",
      );
    }

    if (error instanceof ProfileNotOnboardedError) {
      return fail("FORBIDDEN", ONBOARDING_ERROR);
    }

    if (error instanceof EmailVerificationRequiredError) {
      return fail(
        "FORBIDDEN",
        "Verify your email before editing your profile.",
      );
    }

    if (error instanceof AuthenticationRequiredError) {
      return fail("UNAUTHENTICATED", "Sign in to edit your profile.");
    }

    return fail("INTERNAL_ERROR", PROFILE_EDIT_GENERIC_ERROR);
  }
}
