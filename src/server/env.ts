import "server-only";

import { parseEnv } from "@/lib/env";

/**
 * Validated database-only environment for server-side code.
 *
 * This remains the Phase 0 boundary used by the Prisma singleton and
 * `scripts/db-check.ts`; it does not require Better Auth secrets.
 */
export const env = parseEnv(process.env);
