import "server-only";

import { getServerSession } from "@/server/auth/session";
import { getAvatarStorage } from "./current-avatar-storage";
import {
  saveOwnAvatar,
  removeOwnAvatar,
  requireOwnAvatarCapability,
} from "./own-avatar";
import { prisma } from "@/server/db";

/**
 * Runtime own-avatar access for the current server-authenticated user.
 *
 * The session is resolved here, so no route or component can supply a user id, a
 * URL, or a storage key.
 */
export async function saveCurrentOwnAvatar(
  bytes: Buffer,
): Promise<{ avatarUrl: string }> {
  const session = await getServerSession();
  const storage = getAvatarStorage();

  return saveOwnAvatar(session, bytes, storage, prisma);
}

/**
 * Authorize an avatar mutation before any expensive work happens.
 *
 * Called at the very start of the upload route so a request body is never read
 * and an image is never decoded for a caller who is not allowed to change an
 * avatar. The write itself authorizes again.
 */
export async function requireCurrentOwnAvatarCapability(): Promise<void> {
  const session = await getServerSession();
  await requireOwnAvatarCapability(session, prisma);
}

export async function removeCurrentOwnAvatar(): Promise<void> {
  const session = await getServerSession();
  const storage = getAvatarStorage();

  return removeOwnAvatar(session, storage, prisma);
}
