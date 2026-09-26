import { getCurrentProfileViewer } from "@/server/profiles/current-viewer";
import {
  isProfileVisibleTo,
  visibilityTargetSelect,
} from "@/server/profiles/visibility";
import { getAvatarStorage } from "@/server/avatars/current-avatar-storage";
import { findProfileByAvatarUrl } from "@/server/avatars/own-avatar";
import {
  avatarObjectKeyForToken,
  AVATAR_CONTENT_TYPE,
  isValidAvatarToken,
} from "@/server/avatars/token";
import { prisma } from "@/server/db";

/**
 * Authorized avatar delivery.
 *
 * A token in the URL is not authorization. This route resolves the owning profile,
 * applies exactly the same target-eligibility and visibility policy as the public
 * profile page, and only then reads the object. An unknown token, a missing
 * profile, an ineligible account, and a profile the viewer may not see all produce
 * the same bare 404, so the route cannot be used to discover which tokens exist or
 * why access was refused.
 *
 * Responses are `private, no-store` because authorization here is viewer-dependent
 * and a profile's visibility can change at any moment. A shared cache must never be
 * able to hand a previously visible avatar to a viewer who is no longer entitled
 * to it, and privacy correctness outranks avatar caching throughput in Phase 2.
 */

export const dynamic = "force-dynamic";

/** Not-found response, identical for every unavailable case. */
function notFoundResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  if (!isValidAvatarToken(token)) {
    return notFoundResponse();
  }

  // Resolve the owning profile through the shared boundary, which uses the
  // `@unique` lookup. There is no token search, no prefix match, and no listing.
  const avatarUrl = `/avatars/${token}`;
  const profile = await findProfileByAvatarUrl(avatarUrl, prisma);

  if (profile === null) {
    return notFoundResponse();
  }

  // The same policy the profile page uses, so a private profile's avatar is
  // exactly as private as the profile itself.
  const target = await prisma.user.findUnique({
    where: { id: profile.userId },
    select: visibilityTargetSelect,
  });

  const viewer = await getCurrentProfileViewer();

  if (target === null || !isProfileVisibleTo(target, viewer, profile.userId)) {
    return notFoundResponse();
  }

  let bytes: Buffer | null;
  try {
    bytes = await getAvatarStorage().get(avatarObjectKeyForToken(token));
  } catch {
    // A storage failure is reported as a plain 404 rather than a 500, so it does
    // not become a way to distinguish "the object is broken" from "not allowed".
    return notFoundResponse();
  }

  if (bytes === null) {
    return notFoundResponse();
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": AVATAR_CONTENT_TYPE,
      "Content-Length": String(bytes.length),
      // Never stored by a shared cache. The response also varies by cookie because
      // the authorization decision does, so a cache that ignored no-store could not
      // safely reuse it either.
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      // An avatar is not a document, so it must not be embedded or framed.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
