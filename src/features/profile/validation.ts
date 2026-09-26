import { z } from "zod";

import { createZodResolver } from "@/features/auth/validation";

/**
 * Own-profile edit validation.
 *
 * The schema is `.strict()` so any key the form does not own — `userId`,
 * `avatarUrl`, `onboardingCompletedAt`, `globalRole`, `accountStatus`,
 * `emailVerified`, `User.name`, `User.image` — is rejected outright rather than
 * silently dropped. The server action additionally writes an explicit `Pick`,
 * so a permissive schema could never reach Prisma even if this guard changed.
 *
 * Optional text fields normalize an empty or whitespace-only value to `null` so
 * a cleared field is stored as absent rather than an empty string.
 */

export const PROFILE_DISPLAY_NAME_MIN_LENGTH = 2;
export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 80;
export const PROFILE_HEADLINE_MAX_LENGTH = 120;
export const PROFILE_BIO_MAX_LENGTH = 2000;
export const PROFILE_AVAILABILITY_MIN_HOURS = 0;
export const PROFILE_AVAILABILITY_MAX_HOURS = 168;
export const PROFILE_TIMEZONE_MAX_LENGTH = 64;

export const PROFILE_VISIBILITY_VALUES = [
  "PRIVATE",
  "MEMBERS_ONLY",
  "PUBLIC",
] as const;

/**
 * Control characters that are never acceptable in single-line profile text.
 * Line feeds and tabs are excluded because the bio permits them.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

/** Control characters rejected everywhere, including inside a bio. */
const DANGEROUS_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

const EMPTY_TO_NULL = (value: string | null) =>
  value === null || value.length === 0 ? null : value;

/**
 * Optional text accepts a string or `null`.
 *
 * Accepting `null` makes the schema idempotent: the form resolver emits `null`
 * for a cleared field, and the server action re-validates that already
 * normalized payload with this same schema. Without `null` on the input side,
 * re-validating normalized output would fail with "expected string, received
 * null" and no cleared field could ever be saved.
 */
const nullableText = z.union([z.string(), z.null()]);

const nullableNumberish = z.union([z.string(), z.number(), z.null()]);

function optionalText(maxLength: number, message: string) {
  return nullableText
    .transform((value) => (value === null ? null : value.trim()))
    .refine((value) => value === null || value.length <= maxLength, message)
    .refine(
      (value) => value === null || !CONTROL_CHARACTERS.test(value),
      "Use printable characters only.",
    )
    .transform(EMPTY_TO_NULL);
}

/**
 * Validate an IANA time zone using the runtime's own time-zone database.
 *
 * `Intl.DateTimeFormat` throws a `RangeError` for an unknown zone, so this
 * needs no dependency and no hardcoded allowlist.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const displayNameSchema = z
  .string()
  .trim()
  .min(PROFILE_DISPLAY_NAME_MIN_LENGTH, "Enter at least 2 characters.")
  .max(
    PROFILE_DISPLAY_NAME_MAX_LENGTH,
    `Use no more than ${PROFILE_DISPLAY_NAME_MAX_LENGTH} characters.`,
  )
  .refine(
    (value) => !CONTROL_CHARACTERS.test(value),
    "Use printable characters only.",
  );

/**
 * Availability accepts only a whole number of hours in the inclusive approved
 * range. An empty field becomes `null`. The database stores a plain integer with
 * no CHECK constraint, so this boundary is the only control.
 */
const availabilitySchema = nullableNumberish
  .transform((value, ctx) => {
    if (value === null) {
      return null;
    }

    const raw = typeof value === "number" ? value : value.trim();

    if (raw === "") {
      return null;
    }

    if (typeof raw === "number" && !Number.isInteger(raw)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a whole number of hours.",
      });
      return z.NEVER;
    }

    const text = String(raw);

    if (!/^\d+$/.test(text)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a whole number between 0 and 168.",
      });
      return z.NEVER;
    }

    return Number(text);
  })
  .refine(
    (value) => value === null || Number.isInteger(value),
    "Enter a whole number of hours.",
  )
  .refine(
    (value) =>
      value === null ||
      (value >= PROFILE_AVAILABILITY_MIN_HOURS &&
        value <= PROFILE_AVAILABILITY_MAX_HOURS),
    `Enter between ${PROFILE_AVAILABILITY_MIN_HOURS} and ${PROFILE_AVAILABILITY_MAX_HOURS} hours.`,
  );

const bioSchema = nullableText
  .transform((value) => (value === null ? null : value.trim()))
  .refine(
    (value) => value === null || value.length <= PROFILE_BIO_MAX_LENGTH,
    `Use no more than ${PROFILE_BIO_MAX_LENGTH} characters.`,
  )
  .refine(
    (value) => value === null || !DANGEROUS_CONTROL_CHARACTERS.test(value),
    "Use printable characters only.",
  )
  .transform((value) => (value === null || value.length === 0 ? null : value));

const timezoneSchema = nullableText
  .transform((value) => (value === null ? null : value.trim()))
  .refine(
    (value) => value === null || value.length <= PROFILE_TIMEZONE_MAX_LENGTH,
    `Use no more than ${PROFILE_TIMEZONE_MAX_LENGTH} characters.`,
  )
  .transform((value, context) => {
    if (value === null || value.length === 0) {
      return null;
    }

    if (!isValidTimeZone(value)) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid time zone, for example Europe/London.",
      });
      return z.NEVER;
    }

    return value;
  });

export const profileEditSchema = z
  .object({
    displayName: displayNameSchema,
    headline: optionalText(
      PROFILE_HEADLINE_MAX_LENGTH,
      `Use no more than ${PROFILE_HEADLINE_MAX_LENGTH} characters.`,
    ),
    bio: bioSchema,
    availabilityHoursPerWeek: availabilitySchema,
    timezone: timezoneSchema,
    profileVisibility: z.enum(PROFILE_VISIBILITY_VALUES),
  })
  .strict();

export type ProfileEditInput = z.output<typeof profileEditSchema>;
export type ProfileEditFormValues = z.input<typeof profileEditSchema>;

export const profileFormResolver = createZodResolver(profileEditSchema);

/** Human-readable summary used when the action rejects the whole submission. */
export const PROFILE_EDIT_GENERIC_ERROR =
  "We couldn't save your profile right now. Please try again in a moment.";
