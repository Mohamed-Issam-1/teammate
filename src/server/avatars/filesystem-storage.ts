import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  E2E_DATABASE_CONTEXT_ENV,
  E2E_DATABASE_CONTEXT_VALUE,
} from "../../../scripts/test-database-guard";
import { AVATAR_STORAGE_PREFIX, isValidAvatarToken } from "./token";
import {
  AvatarStorageOperationError,
  AvatarStorageUnavailableError,
  type AvatarStorage,
} from "./storage";

/**
 * Filesystem avatar storage for the guarded end-to-end run.
 *
 * This adapter exists so browser tests never need real object-storage
 * credentials. It writes into a temporary directory the guarded runner creates
 * outside the repository and removes afterwards, and it is only ever constructed
 * when the end-to-end marker is present, which `getAvatarStorage` enforces.
 *
 * Hardening that matters even here:
 *
 * - filenames are derived from the token, never from the request, and a key that
 *   does not match the expected `avatars/<token>.webp` shape is refused outright
 *   rather than sanitized into something that might collide;
 * - the resolved path is verified to stay inside the base directory, so a
 *   traversal attempt cannot escape even if the key check were bypassed;
 * - there is no HTTP surface, no listing, and no way to read a file by an
 *   arbitrary name.
 */

const KEY_PATTERN = new RegExp(
  `^${AVATAR_STORAGE_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`,
);

export function createFilesystemAvatarStorage(
  baseDirectory: string,
  env: Record<string, string | undefined> = process.env,
): AvatarStorage {
  // Defence in depth, mirroring the guarded development email transport: the
  // selector already refuses this adapter outside an end-to-end run, and the
  // adapter itself refuses it too. If the selector were ever reordered or a
  // stray environment variable leaked into a deployment, avatars would still fail
  // closed here rather than silently persisting to a local directory instead of
  // the configured bucket.
  if (
    env[E2E_DATABASE_CONTEXT_ENV] !== E2E_DATABASE_CONTEXT_VALUE ||
    env.NODE_ENV === "production"
  ) {
    throw new AvatarStorageUnavailableError();
  }

  if (typeof baseDirectory !== "string" || baseDirectory.length === 0) {
    throw new AvatarStorageUnavailableError();
  }

  const base = path.resolve(baseDirectory);

  /** Resolve a key to an absolute path, or refuse it. */
  const resolveKey = (key: string): string => {
    if (!KEY_PATTERN.test(key)) {
      throw new AvatarStorageOperationError();
    }

    const resolved = path.resolve(base, key);

    // Belt and braces: the pattern already forbids separators, so this only ever
    // fires if that pattern were ever weakened.
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new AvatarStorageOperationError();
    }

    return resolved;
  };

  return {
    async put(key, bytes) {
      try {
        const target = resolveKey(key);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
      } catch {
        throw new AvatarStorageOperationError();
      }
    },

    async get(key) {
      let target: string;
      try {
        target = resolveKey(key);
      } catch {
        throw new AvatarStorageOperationError();
      }

      try {
        return await readFile(target);
      } catch {
        // A missing avatar is a normal outcome and stays indistinguishable from
        // any other unreadable object.
        return null;
      }
    },

    async delete(key) {
      try {
        await rm(resolveKey(key), { force: true });
      } catch {
        throw new AvatarStorageOperationError();
      }
    },
  };
}

/** Whether a storage key is one this adapter is willing to touch. */
export function isFilesystemAvatarKey(key: string): boolean {
  return (
    KEY_PATTERN.test(key) &&
    isValidAvatarToken(key.slice(AVATAR_STORAGE_PREFIX.length, -5))
  );
}
