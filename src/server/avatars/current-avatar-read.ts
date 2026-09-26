import "server-only";

import { prisma } from "@/server/db";
import { getServerSession } from "@/server/auth/session";
import { parseAvatarTokenFromUrl } from "./token";

/**
 * The current viewer's own avatar reference, for the profile page.
 *
 * Returns only the path the server itself stored, and re-parses it with the strict
 * parser before use. An unexpected or legacy value is reported as "no avatar" so
 * the UI falls back to the initials placeholder rather than rendering a URL the
 * database happens to contain.
 */
export async function getCurrentOwnAvatarUrl(): Promise<string | null> {
  const session = await getServerSession();

  if (session === null || session.user.emailVerified !== true) {
    return null;
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: session.user.id },
    select: { avatarUrl: true, onboardingCompletedAt: true },
  });

  if (profile === null || profile.onboardingCompletedAt === null) {
    return null;
  }

  return parseAvatarTokenFromUrl(profile.avatarUrl) === null
    ? null
    : profile.avatarUrl;
}
