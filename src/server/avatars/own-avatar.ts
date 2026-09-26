import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { requireActiveVerifiedSession } from "@/server/auth/policy";
import {
  avatarObjectKeyForToken,
  avatarObjectKeyFromUrl,
  avatarUrlForToken,
  generateAvatarToken,
} from "./token";
import type { AvatarStorage } from "./storage";
import {
  reportAvatarDeletionCleanupFailure,
  reportAvatarReplacementCleanupFailure,
  reportAvatarUploadCompensationCleanupFailure,
} from "./operational-log";

/**
 * Own-avatar write boundary.
 *
 * Every function is session-scoped: the user identity comes only from the
 * authenticated session, and none accepts a user identifier, a URL, or a storage
 * key from a caller. There is no way to address another account's avatar, and no
 * way to choose what `avatarUrl` becomes beyond "the server's own route for a
 * freshly generated token".
 */

/**
 * The narrowest database contract these writes need.
 *
 * Method-level `Pick`, so `avatarUrl` is the only writable column reachable and
 * the `user` delegate is limited to the two reads the flows require. A write to
 * any other profile field, or to `User`, is a compile error rather than a review
 * question.
 */
export type OwnAvatarDatabase = {
  profile: Pick<PrismaClient["profile"], "findUnique" | "updateMany">;
  user: Pick<PrismaClient["user"], "findUnique">;
};

export type OwnAvatarSession = {
  user: { id: string; accountStatus: string; emailVerified: boolean };
};

export class AvatarNotOnboardedError extends Error {
  constructor() {
    super("Profile onboarding is not complete");
    this.name = "AvatarNotOnboardedError";
  }
}

export class AvatarWriteFailedError extends Error {
  constructor() {
    super("The avatar could not be saved");
    this.name = "AvatarWriteFailedError";
  }
}

/**
 * Resolve the session user, or throw the appropriate fail-closed policy error.
 */
function requireOwnedIdentity(session: OwnAvatarSession | null): string {
  return requireActiveVerifiedSession(session).user.id;
}

/**
 * The caller's own `avatarUrl`, or `null` when there is none.
 *
 * Onboarding completion is required, because a profile without it is not
 * something the user manages yet, and this is a precondition read rather than part
 * of the write. That is the same accepted trade-off the own-profile and
 * assignment boundaries make: completion is monotonic in Phase 2, so a
 * read-then-write cannot produce an invalid state.
 */
async function readOwnAvatarUrl(
  userId: string,
  database: Pick<OwnAvatarDatabase, "profile">,
): Promise<string | null> {
  const profile = await database.profile.findUnique({
    where: { userId },
    select: { avatarUrl: true, onboardingCompletedAt: true },
  });

  if (profile === null || profile.onboardingCompletedAt === null) {
    throw new AvatarNotOnboardedError();
  }

  return profile.avatarUrl;
}

/**
 * Point the caller's profile at a new avatar.
 *
 * Scoped to the caller's own row and to an onboarded profile, and the payload is
 * an explicit literal, so no other field and no other account can be affected.
 */
async function writeOwnAvatarUrl(
  userId: string,
  avatarUrl: string | null,
  database: Pick<OwnAvatarDatabase, "profile">,
): Promise<void> {
  const result = await database.profile.updateMany({
    where: { userId, onboardingCompletedAt: { not: null } },
    data: { avatarUrl },
  });

  if (result.count !== 1) {
    // The conditional write matched no row, so the account is not onboarded or the
    // profile disappeared mid-flight. Fail rather than write a partial state.
    throw new AvatarNotOnboardedError();
  }
}

/**
 * Require that the caller may manage an avatar, before any expensive work.
 *
 * Split out from the write flows so an HTTP entry point can authorize *first*,
 * ahead of reading a request body or decoding an image. Without this, the
 * multi-megabyte decode would run for any caller that could satisfy a same-origin
 * check, including a signed-out visitor, which turns the upload endpoint into an
 * unauthenticated CPU and memory exhaustion primitive.
 *
 * The write flows call this too, so the pre-check is an optimization and never the
 * only check: the boundary re-verifies the session and the onboarded profile
 * immediately before it writes.
 *
 * @throws {AuthenticationRequiredError} for a missing or non-ACTIVE session
 * @throws {EmailVerificationRequiredError} for an unverified account
 * @throws {AvatarNotOnboardedError} when onboarding is not complete
 */
export async function requireOwnAvatarCapability(
  session: OwnAvatarSession | null,
  database: Pick<OwnAvatarDatabase, "profile">,
): Promise<string> {
  const userId = requireOwnedIdentity(session);
  // Reuses the same onboarded-profile precondition the write applies.
  await readOwnAvatarUrl(userId, database);
  return userId;
}

/**
 * Mint a token that no profile currently references.
 *
 * A CSPRNG collision is vanishingly unlikely, but the consequence of not checking
 * would be destructive rather than merely a failed write: the object would be
 * written over the existing owner's and then removed by compensation. Checking
 * first is one indexed lookup and makes the cleanup path provably safe. Bounded
 * attempts so a pathological case cannot spin.
 */
async function claimUnusedToken(
  database: Pick<OwnAvatarDatabase, "profile">,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateAvatarToken();
    const existing = await database.profile.findUnique({
      where: { avatarUrl: avatarUrlForToken(token) },
      select: { userId: true },
    });

    if (existing === null) {
      return token;
    }
  }

  throw new AvatarWriteFailedError();
}

/**
 * Upload, or replace, the caller's own avatar.
 *
 * The processed bytes are already normalized WebP by the time they arrive here.
 * The sequence is deliberately ordered so the user is never left without an
 * avatar and never points at bytes that do not exist:
 *
 * 1. authorize, requiring an onboarded profile;
 * 2. remember the previous TeamMate-owned object key, if any;
 * 3. write the NEW object first, so a storage failure leaves the old avatar intact;
 * 4. update the database to point at the new token;
 * 5. if that update fails, best-effort delete the new object, because nothing
 *    references it and it would otherwise be an orphan;
 * 6. once the database points at the new object, best-effort delete the old one.
 *
 * Database and object storage cannot share a transaction, so a crash between
 * steps 4 and 6 leaves an unreferenced old object. That residual orphan is
 * preferable to the alternative: deleting the old object first could leave a
 * profile pointing at bytes that no longer exist. The risk is recorded in
 * `docs/09_SECURITY.md`.
 */
export async function saveOwnAvatar(
  session: OwnAvatarSession | null,
  bytes: Buffer,
  storage: AvatarStorage,
  database: OwnAvatarDatabase,
): Promise<{ avatarUrl: string }> {
  const userId = requireOwnedIdentity(session);
  const previousAvatarUrl = await readOwnAvatarUrl(userId, database);

  // Mint a token and confirm nothing already owns it before any object is written.
  // `avatarUrl` is unique, so a collision would be refused at the database, but
  // storing first and compensating afterwards would mean overwriting the existing
  // owner's live object and then deleting it. Checking up front keeps the
  // compensation sound: on this path the new object is provably ours.
  const token = await claimUnusedToken(database);
  const newKey = avatarObjectKeyForToken(token);

  // Storage first: if this fails the old avatar is still the live one.
  await storage.put(newKey, bytes, "image/webp");

  try {
    await writeOwnAvatarUrl(userId, avatarUrlForToken(token), database);
  } catch (error) {
    // Nothing references the new object, so remove it rather than orphan it. A
    // cleanup failure never changes the caller's outcome, and the important
    // invariant is that the old avatar still resolves; the fixed operational line
    // is the only trace, so a persistent failure is still visible.
    await deleteQuietly(
      storage,
      newKey,
      reportAvatarUploadCompensationCleanupFailure,
    );
    throw error;
  }

  // Only now is the old object unreferenced.
  const previousKey = avatarObjectKeyFromUrl(previousAvatarUrl);
  if (previousKey !== null && previousKey !== newKey) {
    await deleteQuietly(
      storage,
      previousKey,
      reportAvatarReplacementCleanupFailure,
    );
  }

  return { avatarUrl: avatarUrlForToken(token) };
}

/**
 * Remove the caller's own avatar.
 *
 * The database is cleared first and unconditionally. Storage cleanup happens only
 * after the private state is already gone, and a cleanup failure never restores
 * the reference: privacy state in the database wins over tidying leftover bytes,
 * so a failure here cannot put a reachable avatar back in place.
 */
export async function removeOwnAvatar(
  session: OwnAvatarSession | null,
  storage: AvatarStorage,
  database: OwnAvatarDatabase,
): Promise<void> {
  const userId = requireOwnedIdentity(session);
  const currentAvatarUrl = await readOwnAvatarUrl(userId, database);

  await writeOwnAvatarUrl(userId, null, database);

  const key = avatarObjectKeyFromUrl(currentAvatarUrl);
  if (key !== null) {
    await deleteQuietly(storage, key, reportAvatarDeletionCleanupFailure);
  }
}

/**
 * Best-effort delete that never changes the outcome of the caller's request.
 *
 * Only an exact TeamMate-owned key reaches storage, so an unexpected or legacy
 * `avatarUrl` cannot be turned into an arbitrary deletion. The caller supplies the
 * fixed reporter so each of the three cleanup paths is distinguishable in a log
 * without any of them logging an error object.
 */
async function deleteQuietly(
  storage: AvatarStorage,
  key: string,
  report: () => void,
): Promise<void> {
  try {
    await storage.delete(key);
  } catch {
    // The database already reflects the intended state, so the request stands.
    report();
  }
}

/**
 * Resolve the profile that owns a stored `avatarUrl`, for the delivery route.
 *
 * `findUnique` on `avatarUrl`, which the schema now declares `@unique`, so exactly
 * one non-null value maps to at most one profile. That makes token resolution
 * structural rather than probabilistic, and it is index-backed rather than a
 * sequential scan on a public route.
 *
 * There is no token search, no prefix match, and no listing.
 */
export async function findProfileByAvatarUrl(
  avatarUrl: string,
  database: Pick<OwnAvatarDatabase, "profile">,
): Promise<{ userId: string } | null> {
  const profile = await database.profile.findUnique({
    where: { avatarUrl },
    select: { userId: true },
  });

  return profile;
}
