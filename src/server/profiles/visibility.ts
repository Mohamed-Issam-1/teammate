import type { ProfileViewer } from "./current-viewer";

/**
 * The single profile-visibility policy.
 *
 * Both the public profile page and the avatar delivery route authorize through
 * these two functions, so a profile and its avatar can never end up with
 * subtly different rules. If the semantics change, they change here once.
 *
 * The shape of the answer is deliberately boolean with no reason attached: a
 * caller cannot distinguish "not allowed" from "does not exist" because nothing
 * downstream is ever told which.
 */

export type ProfileVisibility = "PRIVATE" | "MEMBERS_ONLY" | "PUBLIC";

/** The minimum target data an eligibility decision needs. */
export type VisibilityTarget = {
  accountStatus: string;
  emailVerified: boolean;
  profile: { onboardingCompletedAt: Date | null } | null;
};

/** The authorization query every visible surface shares. */
export type VisibilityTargetRow = VisibilityTarget & {
  profile: {
    onboardingCompletedAt: Date | null;
    profileVisibility: ProfileVisibility;
  } | null;
};

/**
 * A target is viewable only when the account behind it is ACTIVE, email-verified,
 * and finished onboarding, and a `Profile` row exists.
 *
 * This is checked before visibility everywhere, so a suspended, unverified, or
 * half-set-up account is never exposed even when its profile is `PUBLIC`.
 */
export function isEligibleTarget(target: VisibilityTarget): boolean {
  return (
    target.accountStatus === "ACTIVE" &&
    target.emailVerified === true &&
    target.profile !== null &&
    target.profile.onboardingCompletedAt !== null
  );
}

/**
 * Whether a viewer may see a target with the given visibility.
 *
 * `PRIVATE` is owner-only. `MEMBERS_ONLY` additionally admits any eligible
 * member, where "eligible" means the viewer context resolved to a member, and an
 * ineligible signed-in viewer has already been collapsed to the anonymous tier.
 * `PUBLIC` admits everyone, including anonymous visitors.
 */
export function canViewProfile(
  profileVisibility: ProfileVisibility,
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

/** Whether the viewer owns the target, from the session-resolved identity. */
export function isProfileOwner(
  viewer: ProfileViewer,
  targetUserId: string,
): boolean {
  return viewer.kind === "member" && viewer.userId === targetUserId;
}

/**
 * The single authorization decision for any visible profile surface.
 *
 * Returns `false` for an ineligible target exactly as it does for an
 * unauthorized one, so no caller can branch on the reason.
 */
export function isProfileVisibleTo(
  target: VisibilityTargetRow,
  viewer: ProfileViewer,
  targetUserId: string,
): boolean {
  if (!isEligibleTarget(target) || target.profile === null) {
    return false;
  }

  return canViewProfile(
    target.profile.profileVisibility,
    viewer,
    isProfileOwner(viewer, targetUserId),
  );
}

/**
 * The authorization select every visible surface shares.
 *
 * Declared once so the profile page and the avatar route cannot drift into
 * checking different columns.
 */
export const visibilityTargetSelect = {
  accountStatus: true,
  emailVerified: true,
  profile: {
    select: {
      profileVisibility: true,
      onboardingCompletedAt: true,
    },
  },
} as const;
