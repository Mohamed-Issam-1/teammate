import "server-only";

import type { AuthEmailOperations } from "@/server/auth/options";

/**
 * Checkpoint 1 email boundary.
 *
 * Better Auth needs semantic verification/reset operations to instantiate its
 * configuration. Real delivery is intentionally deferred: no provider SDK,
 * mailbox route, template system, URL logging, or token logging is included.
 */

const noopEmailOperation = async (): Promise<void> => {};

export const authEmail: AuthEmailOperations = {
  sendVerificationEmail: noopEmailOperation,
  sendPasswordResetEmail: noopEmailOperation,
};
