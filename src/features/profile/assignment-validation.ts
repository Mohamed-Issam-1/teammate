import { z } from "zod";

/**
 * Own skill/interest assignment validation.
 *
 * Both schemas are `.strict()`, so a payload carrying anything beyond the
 * documented fields is rejected outright rather than silently dropped. In
 * particular this is what stops a client from attempting to set `userId`,
 * `globalRole`, `accountStatus`, or any taxonomy field (`name`, `slug`,
 * `nameKey`, `category`) through an assignment action.
 *
 * A taxonomy id is accepted syntactically here and verified to exist against the
 * database at the server boundary, because a well-formed UUID alone proves
 * nothing about whether the row is real.
 */

export const PROFICIENCY_LEVELS = [
  "BEGINNER",
  "INTERMEDIATE",
  "ADVANCED",
  "EXPERT",
] as const;

/** Approved application-validation range for self-reported years of experience. */
export const YEARS_EXPERIENCE_MIN = 0;
export const YEARS_EXPERIENCE_MAX = 100;

/**
 * Optional whole number of years.
 *
 * Empty input normalizes to `null`. String input must be pure digits, so
 * negative values, fractions, exponent notation, hex, and arbitrary strings are
 * rejected rather than coerced.
 *
 * Numeric input is checked with `Number.isInteger` and then the range below.
 * Note that a JSON number written as `1e2` is indistinguishable from `100` after
 * parsing — they are the same IEEE-754 value — so it is accepted as `100` rather
 * than rejected. That is correct rather than a bypass: the stored value is still
 * an integer inside the approved range, and no representation of the number can
 * express an out-of-range value that the range check would not also reject.
 */
const yearsExperienceSchema = z
  .union([z.string(), z.number(), z.null()])
  .transform((value, context) => {
    if (value === null) {
      return null;
    }

    const raw = typeof value === "number" ? value : value.trim();

    if (raw === "") {
      return null;
    }

    if (typeof raw === "number" && !Number.isInteger(raw)) {
      context.addIssue({
        code: "custom",
        message: "Enter a whole number of years.",
      });
      return z.NEVER;
    }

    if (!/^\d+$/.test(String(raw))) {
      context.addIssue({
        code: "custom",
        message: `Enter a whole number between ${YEARS_EXPERIENCE_MIN} and ${YEARS_EXPERIENCE_MAX}.`,
      });
      return z.NEVER;
    }

    return Number(raw);
  })
  .refine(
    (value) =>
      value === null ||
      (value >= YEARS_EXPERIENCE_MIN && value <= YEARS_EXPERIENCE_MAX),
    `Enter a whole number between ${YEARS_EXPERIENCE_MIN} and ${YEARS_EXPERIENCE_MAX}.`,
  );

export const saveSkillAssignmentSchema = z
  .object({
    skillId: z.uuid("Select a skill."),
    proficiencyLevel: z.enum(PROFICIENCY_LEVELS, {
      message: "Select a proficiency level.",
    }),
    yearsExperience: yearsExperienceSchema,
  })
  .strict();

export const removeSkillAssignmentSchema = z
  .object({
    skillId: z.uuid("Select a skill."),
  })
  .strict();

export const addInterestAssignmentSchema = z
  .object({
    interestId: z.uuid("Select an interest."),
  })
  .strict();

export const removeInterestAssignmentSchema = z
  .object({
    interestId: z.uuid("Select an interest."),
  })
  .strict();

export type SaveSkillAssignmentInput = z.output<
  typeof saveSkillAssignmentSchema
>;
export type SaveSkillAssignmentFormValues = z.input<
  typeof saveSkillAssignmentSchema
>;
export type RemoveSkillAssignmentInput = z.output<
  typeof removeSkillAssignmentSchema
>;
export type AddInterestAssignmentInput = z.output<
  typeof addInterestAssignmentSchema
>;
export type RemoveInterestAssignmentInput = z.output<
  typeof removeInterestAssignmentSchema
>;
