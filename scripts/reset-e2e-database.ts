import "dotenv/config";

import { assertSafeE2EDatabaseEnvironment } from "./test-database-guard";
import { createPrismaClient } from "../src/server/db/client";

/**
 * Reset end-to-end database state between browser tests.
 *
 * This deletes rows only. It never migrates, pushes, resets, or drops a schema,
 * and the E2E database guard runs first so a misconfigured invocation cannot
 * reach the development database.
 *
 * It lives in its own process because the Playwright worker transpiles
 * TypeScript to CommonJS and cannot require the ESM-only generated Prisma
 * client directly.
 */

Object.assign(process.env, {
  NODE_ENV: "test",
  E2E_TEST_CONTEXT: "teammate-e2e",
});
const { testDatabaseUrl } = assertSafeE2EDatabaseEnvironment(process.env);
const prisma = createPrismaClient(testDatabaseUrl);

async function main(): Promise<void> {
  try {
    await prisma.$transaction([
      // Rate limiting is database-backed and keyed per client IP and path, so a
      // stale window from a previous run would make a fresh run flaky.
      prisma.rateLimit.deleteMany(),
      prisma.session.deleteMany(),
      prisma.account.deleteMany(),
      prisma.verification.deleteMany(),
      prisma.profile.deleteMany(),
      // `UserSkill` and `UserInterest` are intentionally absent: deleting a user
      // cascades to them. Shared `Skill` and `Interest` rows must never be
      // deleted here — they are global and reference-restricted. If a future
      // end-to-end flow ever creates taxonomy rows, it must clean them up
      // explicitly rather than relying on this cascade.
      prisma.user.deleteMany(),
    ]);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Never echo connection values.
  console.error("End-to-end database reset failed.", error instanceof Error);
  process.exit(1);
});
