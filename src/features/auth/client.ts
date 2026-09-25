import { createAuthClient } from "better-auth/react";

/**
 * Browser-only Better Auth boundary for TeamMate's public authentication UI.
 * The client uses same-origin cookies and the existing native auth route.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});
