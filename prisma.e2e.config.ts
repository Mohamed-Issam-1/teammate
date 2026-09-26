import "dotenv/config";

import { defineConfig } from "prisma/config";

import { assertSafeE2EDatabaseEnvironment } from "./scripts/test-database-guard";

/**
 * Prisma configuration for the end-to-end suite.
 *
 * Separate from `prisma.test.config.ts` so the auth integration path keeps its
 * own fail-closed marker and is neither relaxed nor reused. The E2E guard
 * applies the same strict target comparison and additionally refuses to run
 * while `NODE_ENV` is `production`.
 */
const { testDatabaseUrl } = assertSafeE2EDatabaseEnvironment(process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: testDatabaseUrl,
  },
});
