import "server-only";

import { parseAuthEnv } from "@/lib/env";

/**
 * Validated Better Auth runtime environment.
 *
 * This dedicated server-only boundary keeps authentication secrets out of the
 * database-only environment module used by Phase 0 infrastructure code.
 */
export const authEnv = parseAuthEnv(process.env);
