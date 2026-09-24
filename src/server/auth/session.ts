import "server-only";

import { headers } from "next/headers";

import { auth } from "./index";

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

  if (!session || session.user.accountStatus !== "ACTIVE") {
    return null;
  }

  return session;
}

export async function requireServerSession() {
  const session = await getServerSession();

  if (!session) {
    throw new Error("Authentication required");
  }

  if (!session.user.emailVerified) {
    throw new Error("Email verification required");
  }

  return session;
}
