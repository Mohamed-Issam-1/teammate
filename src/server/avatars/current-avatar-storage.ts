import "server-only";

import {
  E2E_DATABASE_CONTEXT_ENV,
  E2E_DATABASE_CONTEXT_VALUE,
} from "../../../scripts/test-database-guard";
import { createFilesystemAvatarStorage } from "./filesystem-storage";
import { createS3AvatarStorage, readAvatarS3Config } from "./s3";
import { AvatarStorageUnavailableError, type AvatarStorage } from "./storage";

/**
 * Runtime avatar storage selection.
 *
 * Exactly one of two adapters is ever reachable:
 *
 * - the S3-compatible adapter, which requires real configuration and fails closed
 *   without it;
 * - a filesystem adapter, available only under the guarded end-to-end test marker
 *   and refused outright in production.
 *
 * There is no production fallback to the filesystem. If configuration is missing,
 * an avatar operation fails rather than quietly writing somewhere temporary.
 */

let cached: AvatarStorage | null = null;

/**
 * Whether this process is explicitly an end-to-end test run.
 *
 * Reuses the same marker the database guard uses, so "is this a test run" has one
 * answer in the codebase rather than several.
 */
export function isEndToEndTestProcess(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env[E2E_DATABASE_CONTEXT_ENV] === E2E_DATABASE_CONTEXT_VALUE &&
    env.NODE_ENV !== "production"
  );
}

/**
 * Resolve the avatar storage for this process.
 *
 * Lazy and memoized: the S3 client is only constructed on first use, so a build,
 * a typecheck, or a unit test that never touches avatars does not require any
 * storage configuration to exist.
 */
export function getAvatarStorage(): AvatarStorage {
  if (cached !== null) {
    return cached;
  }

  if (isEndToEndTestProcess()) {
    const directory = process.env.E2E_AVATAR_STORAGE_DIR;

    if (typeof directory !== "string" || directory.length === 0) {
      throw new AvatarStorageUnavailableError();
    }

    cached = createFilesystemAvatarStorage(directory);
    return cached;
  }

  cached = createS3AvatarStorage(readAvatarS3Config(process.env));
  return cached;
}

/** Reset the memoized adapter. Test-only. */
export function resetAvatarStorageForTests(): void {
  cached = null;
}
