import "server-only";

import { parseEnv } from "@/lib/env";

/**
 * Validated environment for server-side code.
 *
 * Marked `server-only`: private values such as `DATABASE_URL` and provider
 * keys can never be pulled into a client bundle. Client-visible configuration
 * must be read from `process.env.NEXT_PUBLIC_*` at the framework boundary.
 *
 * Phase 0 enforcement scope: `DATABASE_URL` required, `NODE_ENV` validated
 * when present. `BETTER_AUTH_*` and provider variables stay optional until
 * their owning phase.
 */
export const env = parseEnv(process.env);
