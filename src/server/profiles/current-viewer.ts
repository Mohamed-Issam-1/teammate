import "server-only";

import { getServerSession } from "@/server/auth/session";

/**
 * Viewer context for routes that anonymous visitors can reach.
 *
 * Most reads in this codebase go through `requireServerSession`, which throws for
 * a missing or ineligible session. That is the wrong shape for a public route:
 * an anonymous visitor is a legitimate viewer, not an error. So this boundary
 * resolves a two-state context instead of asserting a session.
 *
 * Eligible means an ACTIVE, email-verified account. Onboarding completion is
 * deliberately *not* required of the viewer: the Source of Truth does not define
 * "member" more narrowly than "a signed-in TeamMate account", and requiring
 * onboarding here would deny access to signed-in users for a reason unrelated to
 * anything this route is about.
 */
export type ProfileViewer =
  { kind: "anonymous" } | { kind: "member"; userId: string };

/**
 * Resolve the current request's viewer.
 *
 * An authenticated-but-ineligible session (suspended, non-ACTIVE, or unverified)
 * is deliberately collapsed into `anonymous` rather than given its own state.
 * `getServerSession` already drops non-ACTIVE accounts, and an unverified account
 * is mapped to the weakest tier, so an ineligible viewer can never gain a
 * privilege an anonymous visitor lacks. Collapsing the states also means there is
 * no code path that treats "authenticated" as sufficient for access.
 *
 * This does not throw. A missing session is a valid outcome here, and neither is
 * an unexpected failure while reading the session: a public page should degrade
 * to its weakest tier rather than render a server error. That direction is
 * fail-closed, since anonymous is exactly the tier with the fewest rights, and it
 * matches the existing fail-closed pattern in the auth options. The cost is that a
 * genuine database outage on this route presents as a not-found page instead of a
 * 500, which is recorded in `docs/09_SECURITY.md`.
 */
export async function getCurrentProfileViewer(): Promise<ProfileViewer> {
  let session: Awaited<ReturnType<typeof getServerSession>> = null;

  try {
    session = await getServerSession();
  } catch {
    return { kind: "anonymous" };
  }

  // Defensive on the shape as well as the call: this boundary must not be the
  // thing that turns an unexpected session shape into a thrown error.
  if (typeof session?.user?.emailVerified !== "boolean") {
    return { kind: "anonymous" };
  }

  if (session.user.emailVerified !== true) {
    return { kind: "anonymous" };
  }

  return { kind: "member", userId: session.user.id };
}
