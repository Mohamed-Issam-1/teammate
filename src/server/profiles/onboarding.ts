import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { requireActiveVerifiedSession } from "@/server/auth/policy";
import { onboardingInputSchema } from "@/features/onboarding/validation";

export type OnboardingDatabase = Pick<PrismaClient, "profile" | "$transaction">;

export type OnboardingSession = {
  user: {
    id: string;
    name: string;
    accountStatus: string;
    emailVerified: boolean;
  };
};

export type OnboardingState = {
  displayName: string;
  onboardingComplete: boolean;
  profileExists: boolean;
};

export type OnboardingCompletion = OnboardingState & {
  completedNow: boolean;
};

export class InvalidOnboardingInputError extends Error {
  constructor() {
    super("Invalid onboarding input");
    this.name = "InvalidOnboardingInputError";
  }
}

const profileSelect = {
  userId: true,
  displayName: true,
  onboardingCompletedAt: true,
} as const;

/**
 * Resolve onboarding state for an already-authenticated session. The session
 * remains the only source of identity; callers cannot provide a user ID.
 */
export async function getOnboardingStateForSession(
  session: OnboardingSession | null,
  database: OnboardingDatabase,
): Promise<OnboardingState> {
  const activeSession = requireActiveVerifiedSession(session);
  const profile = await database.profile.findUnique({
    where: { userId: activeSession.user.id },
    select: profileSelect,
  });

  return {
    displayName: profile?.displayName ?? activeSession.user.name,
    onboardingComplete:
      profile !== null && profile.onboardingCompletedAt !== null,
    profileExists: profile !== null,
  };
}

/**
 * Complete onboarding for the supplied authenticated session.
 *
 * The conditional update makes completion idempotent: a second concurrent or
 * later submission cannot rewrite an existing completion timestamp or replace
 * the canonical display name after onboarding has completed.
 */
export async function completeOnboardingForSession(
  session: OnboardingSession | null,
  input: unknown,
  database: OnboardingDatabase,
): Promise<OnboardingCompletion> {
  const activeSession = requireActiveVerifiedSession(session);
  const parsedInput = onboardingInputSchema.safeParse(input);

  if (!parsedInput.success) {
    throw new InvalidOnboardingInputError();
  }

  const { displayName } = parsedInput.data;
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        const existingProfile = await transaction.profile.findUnique({
          where: { userId: activeSession.user.id },
          select: profileSelect,
        });

        if (
          existingProfile !== null &&
          existingProfile.onboardingCompletedAt !== null
        ) {
          return {
            displayName: existingProfile.displayName,
            onboardingComplete: true,
            profileExists: true,
            completedNow: false,
          };
        }

        if (existingProfile !== null) {
          const updateResult = await transaction.profile.updateMany({
            where: {
              userId: activeSession.user.id,
              onboardingCompletedAt: null,
            },
            data: {
              displayName,
              onboardingCompletedAt: new Date(),
            },
          });
          const profile = await transaction.profile.findUniqueOrThrow({
            where: { userId: activeSession.user.id },
            select: profileSelect,
          });

          return {
            displayName: profile.displayName,
            onboardingComplete: profile.onboardingCompletedAt !== null,
            profileExists: true,
            completedNow: updateResult.count === 1,
          };
        }

        const profile = await transaction.profile.create({
          data: {
            userId: activeSession.user.id,
            displayName,
            onboardingCompletedAt: new Date(),
          },
          select: profileSelect,
        });

        return {
          displayName: profile.displayName,
          onboardingComplete: true,
          profileExists: true,
          completedNow: true,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }

  throw new Error("Onboarding completion could not be completed");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
