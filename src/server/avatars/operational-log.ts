/**
 * Fixed operational signals for avatar storage cleanup.
 *
 * Best-effort cleanup stays best-effort: a failed delete must never fail the
 * user's request, revert a successful replacement, or restore a reference the user
 * removed. But a persistently failing cleanup is otherwise completely invisible,
 * so each failure emits one fixed line.
 *
 * The signals accept no arguments at all, matching the auth email operational log.
 * No AWS error, endpoint, bucket name, object key, avatar token, credential, stack,
 * or `cause` can reach the output. There is deliberately no count, no key, and no
 * error object, so the log cannot become a place where storage internals leak.
 *
 * A repeated failure here is the signal that orphan reconciliation is needed; that
 * job is recorded as deferred production hardening.
 */

export const AVATAR_REPLACEMENT_CLEANUP_FAILED_MESSAGE =
  "Avatar replacement cleanup failed.";

export const AVATAR_DELETION_CLEANUP_FAILED_MESSAGE =
  "Avatar deletion cleanup failed.";

export const AVATAR_UPLOAD_COMPENSATION_CLEANUP_FAILED_MESSAGE =
  "Avatar upload compensation cleanup failed.";

export function reportAvatarReplacementCleanupFailure(): void {
  console.error(AVATAR_REPLACEMENT_CLEANUP_FAILED_MESSAGE);
}

export function reportAvatarDeletionCleanupFailure(): void {
  console.error(AVATAR_DELETION_CLEANUP_FAILED_MESSAGE);
}

export function reportAvatarUploadCompensationCleanupFailure(): void {
  console.error(AVATAR_UPLOAD_COMPENSATION_CLEANUP_FAILED_MESSAGE);
}
