import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { compareByCategoryThenName } from "@/server/taxonomy/ordering";
import type { ProfileViewer } from "./current-viewer";

/**
 * Read-only, privacy-filtered profile view.
 *
 * This is the only path that may render another person's profile. It takes a
 * route locator and a viewer, and returns either a safe projection or `null`.
 * `null` is the single answer for every reason a profile is not viewable, so a
 * caller cannot distinguish "no such user" from "not allowed to see this" from
 * "this account is suspended" and therefore cannot leak any of them.
 *
 * Nothing here writes. There is no update, create, or delete in this module or in
 * its database contract.
 */

/**
 * The narrowest database contract this boundary needs.
 *
 * Narrowed to a single method, not to the whole delegate. `Pick<PrismaClient,
 * "user">` would still hand this module `update`, `deleteMany`, and the raw-SQL
 * methods, so the type would promise nothing; picking `findUnique` makes every
 * write a compile error instead of a review question. `select` is explicit at
 * each call site, so no wider model is ever loaded either.
 */
export type VisibleProfileDatabase = {
  user: Pick<PrismaClient["user"], "findUnique">;
};

/** A skill as it may appear on someone else's profile. */
export type VisibleSkill = {
  slug: string;
  name: string;
  category: string | null;
  proficiencyLevel: string;
};

/** An interest as it may appear on someone else's profile. */
export type VisibleInterest = {
  slug: string;
  name: string;
};

/**
 * The safe profile projection.
 *
 * Deliberately absent: any user or profile identifier, `email`, `emailVerified`,
 * `globalRole`, `accountStatus`, `createdAt`, `updatedAt`, `onboardingCompletedAt`,
 * `timezone`, `availabilityHoursPerWeek`, and `yearsExperience`. Those are either
 * auth internals, account state, or the owner's private working preferences.
 */
export type VisibleProfile = {
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  skills: VisibleSkill[];
  interests: VisibleInterest[];
};

/**
 * Upper bound on the route locator.
 *
 * `User.id` is declared as unbounded `text` with no database default and no
 * format constraint, so there is no project-owned grammar to validate against and
 * UUID validation would be wrong. The bound exists only to stop an arbitrarily
 * long path segment from reaching the database. It is deliberately far above the
 * 32-character alphanumeric id Better Auth generates, so a legitimate id can
 * never be rejected, and it is deliberately not a format check: the locator is
 * not authorization, so a stricter pattern would add no security while risking a
 * false "not found" for a real user if the id scheme ever changes.
 */
export const PROFILE_LOCATOR_MAX_LENGTH = 128;

/**
 * Reject control characters so an odd path segment cannot reach the query or a
 * log line. Written as escapes rather than literal characters on purpose.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/**
 * Whether a route segment is a usable profile locator.
 *
 * An invalid locator is not an error: the caller treats it exactly like a missing
 * profile, so a malformed id cannot be distinguished from a nonexistent one.
 */
export function isValidProfileLocator(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= PROFILE_LOCATOR_MAX_LENGTH &&
    !CONTROL_CHARACTERS.test(value)
  );
}

/**
 * Target eligibility.
 *
 * A profile is only viewable if the account behind it is ACTIVE, email-verified,
 * and finished onboarding. Any failure is indistinguishable from the user not
 * existing, so a suspended or half-set-up account is never exposed and its state
 * is never revealed.
 */
function isEligibleTarget(target: {
  accountStatus: string;
  emailVerified: boolean;
  profile: { onboardingCompletedAt: Date | null } | null;
}): boolean {
  return (
    target.accountStatus === "ACTIVE" &&
    target.emailVerified === true &&
    target.profile !== null &&
    target.profile.onboardingCompletedAt !== null
  );
}

/** Whether the viewer may see a target with the given visibility. */
function isVisibleTo(
  profileVisibility: "PRIVATE" | "MEMBERS_ONLY" | "PUBLIC",
  viewer: ProfileViewer,
  isOwner: boolean,
): boolean {
  if (isOwner) {
    return true;
  }

  if (profileVisibility === "PUBLIC") {
    return true;
  }

  if (profileVisibility === "MEMBERS_ONLY") {
    return viewer.kind === "member";
  }

  return false;
}

/**
 * Resolve the profile a viewer may see, or `null` when they may not.
 *
 * Two phases on purpose. The first query fetches the minimum needed to decide
 * authorization and nothing else, so an unauthorized viewer never causes skill or
 * interest rows to be loaded. Only after access is granted does the second query
 * build the projection. A single combined query would read private columns
 * (including `yearsExperience`) for accounts the viewer is not allowed to see.
 */
export async function readVisibleProfile(
  locator: string,
  viewer: ProfileViewer,
  database: VisibleProfileDatabase,
): Promise<VisibleProfile | null> {
  if (!isValidProfileLocator(locator)) {
    return null;
  }

  const target = await database.user.findUnique({
    where: { id: locator },
    select: {
      accountStatus: true,
      emailVerified: true,
      profile: {
        select: {
          profileVisibility: true,
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (target === null || !isEligibleTarget(target)) {
    return null;
  }

  // `isEligibleTarget` already established the relation is present.
  const visibility = target.profile?.profileVisibility;
  if (visibility === undefined) {
    return null;
  }

  const isOwner = viewer.kind === "member" && viewer.userId === locator;

  if (!isVisibleTo(visibility, viewer, isOwner)) {
    return null;
  }

  const profile = await database.user.findUnique({
    where: { id: locator },
    select: {
      profile: {
        select: {
          displayName: true,
          headline: true,
          bio: true,
          avatarUrl: true,
        },
      },
      // `UserSkill` and `UserInterest` hang off `User`, not `Profile`, so the
      // assignment relations are read from here. `yearsExperience` and the
      // taxonomy `nameKey` are absent from this select on purpose.
      userSkills: {
        select: {
          proficiencyLevel: true,
          skill: { select: { slug: true, name: true, category: true } },
        },
      },
      userInterests: {
        select: { interest: { select: { slug: true, name: true } } },
      },
    },
  });

  // The relation existed a moment ago; if it is gone now, the account is being
  // torn down and the correct answer is still "not available".
  if (profile === null || profile.profile === null) {
    return null;
  }

  return {
    displayName: profile.profile.displayName,
    headline: profile.profile.headline,
    bio: profile.profile.bio,
    avatarUrl: profile.profile.avatarUrl,
    skills: profile.userSkills
      .map((entry) => ({
        slug: entry.skill.slug,
        name: entry.skill.name,
        category: entry.skill.category,
        proficiencyLevel: entry.proficiencyLevel,
      }))
      .sort(compareByCategoryThenName),
    interests: profile.userInterests
      .map((entry) => ({
        slug: entry.interest.slug,
        name: entry.interest.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
