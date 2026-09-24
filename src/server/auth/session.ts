import "server-only";

import { headers } from "next/headers";

import { auth } from "./index";
import { getActiveSession, requireActiveVerifiedSession } from "./policy";

/**
 * Return the current active server session.
 *
 * Account status is checked on every server lookup so a suspended user cannot
 * rely on an existing Better Auth session record for authorization.
 */
export async function getServerSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: {
      // Server Component reads must not refresh the database session or emit
      // cookies that this direct API call cannot forward to the browser.
      disableRefresh: true,
    },
  });

  return getActiveSession(session);
}

export async function requireServerSession() {
  return requireActiveVerifiedSession(await getServerSession());
}
