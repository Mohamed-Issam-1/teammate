import "server-only";

import { requireServerSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  getOwnProfileForSession,
  updateOwnProfileForSession,
  type OwnProfile,
} from "./own-profile";

/**
 * Runtime own-profile access for the current server-authenticated user.
 *
 * The session is resolved here so no page or action can supply a user id.
 */

export async function getCurrentOwnProfile(): Promise<OwnProfile> {
  const session = await requireServerSession();
  return getOwnProfileForSession(session, prisma);
}

export async function updateCurrentOwnProfile(
  input: unknown,
): Promise<OwnProfile> {
  const session = await requireServerSession();
  return updateOwnProfileForSession(session, input, prisma);
}
