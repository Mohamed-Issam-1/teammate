import "server-only";

/**
 * Narrow avatar object storage.
 *
 * This is deliberately not a general-purpose object store. It exposes exactly the
 * three operations avatars need, it never accepts a caller-supplied key from a
 * request, and every key it is given is expected to come from
 * `token.ts`. Profile application code therefore cannot read, list, or delete an
 * arbitrary bucket object, and there is no listing or search operation at all.
 */

export type AvatarStorage = {
  /** Store bytes under a server-derived key, overwriting any existing object. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Fetch bytes, or `null` when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Delete an object. Deleting a missing object is a success. */
  delete(key: string): Promise<void>;
};

/** Raised when storage is used without a usable configuration. */
export class AvatarStorageUnavailableError extends Error {
  constructor() {
    super("Avatar storage is not configured.");
    this.name = "AvatarStorageUnavailableError";
  }
}

/** Raised when the storage provider itself fails. */
export class AvatarStorageOperationError extends Error {
  constructor() {
    super("Avatar storage operation failed.");
    this.name = "AvatarStorageOperationError";
  }
}

/**
 * In-memory storage for unit and integration tests.
 *
 * Deliberately injected rather than selected by configuration, so a test can
 * never accidentally be exercising the production adapter and so production can
 * never be given a non-persistent adapter.
 */
export function createInMemoryAvatarStorage(): AvatarStorage & {
  readonly objects: Map<string, Buffer>;
} {
  const objects = new Map<string, Buffer>();

  return {
    objects,
    async put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
    },
    async get(key) {
      const found = objects.get(key);
      return found === undefined ? null : Buffer.from(found);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
