"use server";

import { revalidatePath } from "next/cache";

import {
  fail,
  ok,
  type ActionResult,
  type ActionResultErrorCode,
} from "@/lib/action-result";
import {
  addInterestAssignmentSchema,
  removeInterestAssignmentSchema,
  removeSkillAssignmentSchema,
  saveSkillAssignmentSchema,
} from "@/features/profile/assignment-validation";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import {
  addCurrentInterest,
  removeCurrentInterest,
  removeCurrentSkillAssignment,
  saveCurrentSkillAssignment,
} from "@/server/profiles/current-assignments";
import {
  AssignmentNotOnboardedError,
  InvalidAssignmentInputError,
  TaxonomyEntryUnavailableError,
} from "@/server/profiles/assignments";

/**
 * Own skill/interest assignment actions.
 *
 * Each action parses a strict schema, derives the user from the server session,
 * and delegates to a boundary whose database contract cannot write taxonomy.
 * Expected validation and taxonomy problems are reported specifically; anything
 * unexpected collapses into one generic message with no Prisma, SQL, or
 * identifier detail.
 */

const GENERIC_ERROR =
  "We couldn't update your selections right now. Please try again in a moment.";
const ONBOARDING_ERROR =
  "Finish account setup before managing your selections.";

export type SaveSkillResult = { skillName: string; updated: boolean };
export type RemoveSkillResult = { skillId: string };
export type AddInterestResult = { interestName: string };
export type RemoveInterestResult = { interestId: string };

function toFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
) {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in fieldErrors)) {
      fieldErrors[field] = [issue.message];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

/**
 * Strict-parse helper shared by every action.
 *
 * On success the parsed, normalized data is returned so only schema-approved
 * fields reach the boundary. On failure the per-field messages are returned for
 * display. The boundary re-parses independently, so this is a first line of
 * defence and a UX affordance, never the only one.
 */
function parseInput<Schema extends { safeParse: (value: unknown) => unknown }>(
  schema: Schema,
  input: unknown,
):
  | { ok: true; data: unknown }
  | { ok: false; fieldErrors: Record<string, string[]> } {
  const result = schema.safeParse(input) as
    | { success: true; data: unknown }
    | {
        success: false;
        error?: { issues: readonly { path: PropertyKey[]; message: string }[] };
      };

  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    fieldErrors: toFieldErrors(result.error?.issues ?? []) ?? {
      _form: ["Check the selection and try again."],
    },
  };
}

type ActionFailure = {
  ok: false;
  code: ActionResultErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

function failure(
  code: ActionResultErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionFailure {
  return fieldErrors === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, fieldErrors };
}

/** Shared policy-failure mapping so every action reports the same way. */
function policyFailure(error: unknown): ActionFailure | null {
  if (error instanceof InvalidAssignmentInputError) {
    return failure("VALIDATION_ERROR", "Check the selection and try again.");
  }

  if (error instanceof TaxonomyEntryUnavailableError) {
    return failure(
      "VALIDATION_ERROR",
      error.kind === "skill"
        ? "Selected skill is unavailable."
        : "Selected interest is unavailable.",
    );
  }

  if (error instanceof AssignmentNotOnboardedError) {
    return failure("FORBIDDEN", ONBOARDING_ERROR);
  }

  if (error instanceof EmailVerificationRequiredError) {
    return failure(
      "FORBIDDEN",
      "Verify your email before managing your selections.",
    );
  }

  if (error instanceof AuthenticationRequiredError) {
    return failure("UNAUTHENTICATED", "Sign in to manage your selections.");
  }

  return null;
}

function revalidateProfile() {
  revalidatePath("/app/profile");
}

export async function saveSkillAssignmentAction(
  input: unknown,
): Promise<ActionResult<SaveSkillResult>> {
  const parsed = parseInput(saveSkillAssignmentSchema, input);
  if (!parsed.ok) {
    return fail(
      "VALIDATION_ERROR",
      "Check the highlighted fields.",
      parsed.fieldErrors,
    );
  }

  try {
    const assignment = await saveCurrentSkillAssignment(parsed.data);
    revalidateProfile();
    return ok({ skillName: assignment.name, updated: assignment.updated });
  } catch (error) {
    return policyFailure(error) ?? fail("INTERNAL_ERROR", GENERIC_ERROR);
  }
}

export async function removeSkillAssignmentAction(
  input: unknown,
): Promise<ActionResult<RemoveSkillResult>> {
  const parsed = parseInput(removeSkillAssignmentSchema, input);
  if (!parsed.ok) {
    return fail(
      "VALIDATION_ERROR",
      "Check the highlighted fields.",
      parsed.fieldErrors,
    );
  }

  try {
    const result = await removeCurrentSkillAssignment(parsed.data);
    revalidateProfile();
    return ok(result);
  } catch (error) {
    return policyFailure(error) ?? fail("INTERNAL_ERROR", GENERIC_ERROR);
  }
}

export async function addInterestAssignmentAction(
  input: unknown,
): Promise<ActionResult<AddInterestResult>> {
  const parsed = parseInput(addInterestAssignmentSchema, input);
  if (!parsed.ok) {
    return fail(
      "VALIDATION_ERROR",
      "Check the highlighted fields.",
      parsed.fieldErrors,
    );
  }

  try {
    const interest = await addCurrentInterest(parsed.data);
    revalidateProfile();
    return ok({ interestName: interest.name });
  } catch (error) {
    return policyFailure(error) ?? fail("INTERNAL_ERROR", GENERIC_ERROR);
  }
}

export async function removeInterestAssignmentAction(
  input: unknown,
): Promise<ActionResult<RemoveInterestResult>> {
  const parsed = parseInput(removeInterestAssignmentSchema, input);
  if (!parsed.ok) {
    return fail(
      "VALIDATION_ERROR",
      "Check the highlighted fields.",
      parsed.fieldErrors,
    );
  }

  try {
    const result = await removeCurrentInterest(parsed.data);
    revalidateProfile();
    return ok(result);
  } catch (error) {
    return policyFailure(error) ?? fail("INTERNAL_ERROR", GENERIC_ERROR);
  }
}
