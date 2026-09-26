import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { profileEditSchema } from "@/features/profile/validation";
import { requireActiveVerifiedSession } from "@/server/auth/policy";

/**
 * Own-profile domain boundary.
 *
 * Every function here is session-scoped: the user identity comes only from the
 * authenticated session, and no function accepts a user identifier from a
 * caller. That is what makes IDOR structurally impossible rather than merely
 * validated against.
 */

export type OwnProfileDatabase = Pick<PrismaClient, "profile">;

/** The editable projection returned to the own-profile page. */
export type OwnProfile = {
  displayName: string;
  headline: string | null;
  bio: string | null;
  availabilityHoursPerWeek: number | null;
  timezone: string | null;
  profileVisibility: "PRIVATE" | "MEMBERS_ONLY" | "PUBLIC";
};

export type OwnProfileSession = {
  user: {
    id: string;
    accountStatus: string;
    emailVerified: boolean;
  };
};

/**
 * The authenticated session is active and verified, but onboarding has not been
 * completed, so the own-profile page is not available yet.
 *
 * A missing profile row is reported through this same error. Onboarding is the
 * only path that creates a `Profile`, and it records completion on that row, so
 * "no row" and "row without a completion timestamp" are both simply "not
 * onboarded yet". Routing to `/onboarding` is the safe outcome: nothing is
 * manufactured, and the onboarding flow creates the row on its own terms.
 */
export class ProfileNotOnboardedError extends Error {
  constructor() {
    super("Profile onboarding is not complete");
    this.name = "ProfileNotOnboardedError";
  }
}

export class InvalidProfileInputError extends Error {
  constructor() {
    super("Invalid profile input");
    this.name = "InvalidProfileInputError";
  }
}

const ownProfileSelect = {
  displayName: true,
  headline: true,
  bio: true,
  availabilityHoursPerWeek: true,
  timezone: true,
  profileVisibility: true,
  onboardingCompletedAt: true,
} as const;

/**
 * Read the current session user's own profile.
 *
 * Requires an active, verified, onboarded identity. `avatarUrl` is server-owned
 * and deliberately excluded from the editable projection, as are `userId`,
 * `onboardingCompletedAt`, and the auth-owned fields on `User`.
 */
export async function getOwnProfileForSession(
  session: OwnProfileSession | null,
  database: OwnProfileDatabase,
): Promise<OwnProfile> {
  const activeSession = requireActiveVerifiedSession(session);
  const profile = await database.profile.findUnique({
    where: { userId: activeSession.user.id },
    select: ownProfileSelect,
  });

  if (profile === null || profile.onboardingCompletedAt === null) {
    throw new ProfileNotOnboardedError();
  }

  return {
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    availabilityHoursPerWeek: profile.availabilityHoursPerWeek,
    timezone: profile.timezone,
    profileVisibility: profile.profileVisibility,
  };
}

/**
 * Update the current session user's own editable profile fields.
 *
 * The write is a single-row atomic conditional update. Requiring
 * `onboardingCompletedAt` inside the `where` clause makes "must be onboarded"
 * part of the write itself rather than a check that could be raced, and the
 * user identifier is taken only from the session.
 *
 * The Prisma payload is an explicit object built from validated output. Client
 * input is never spread, so `avatarUrl`, `userId`, `onboardingCompletedAt`, and
 * any auth-owned field cannot be written even if validation were relaxed.
 */
export async function updateOwnProfileForSession(
  session: OwnProfileSession | null,
  input: unknown,
  database: OwnProfileDatabase,
): Promise<OwnProfile> {
  const activeSession = requireActiveVerifiedSession(session);
  const parsedInput = profileEditSchema.safeParse(input);

  if (!parsedInput.success) {
    throw new InvalidProfileInputError();
  }

  const {
    displayName,
    headline,
    bio,
    availabilityHoursPerWeek,
    timezone,
    profileVisibility,
  } = parsedInput.data;

  const result = await database.profile.updateMany({
    where: {
      userId: activeSession.user.id,
      onboardingCompletedAt: { not: null },
    },
    data: {
      displayName,
      headline,
      bio,
      availabilityHoursPerWeek,
      timezone,
      profileVisibility,
    },
  });

  if (result.count !== 1) {
    // The conditional write matched no row, so the account is not onboarded.
    // Nothing is created here; onboarding remains the only creation path.
    throw new ProfileNotOnboardedError();
  }

  return {
    displayName,
    headline,
    bio,
    availabilityHoursPerWeek,
    timezone,
    profileVisibility,
  };
}
