/**
 * Approved Phase 1 auth token expiry policy.
 *
 * The durations live in this dependency-free, CLI-safe module so the Better Auth
 * configuration and the transactional auth email copy can never drift apart.
 * Changing a value here changes both the issued token lifetime and the wording
 * the recipient is shown.
 */

export const AUTH_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 3600;
export const AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS = 3600;
