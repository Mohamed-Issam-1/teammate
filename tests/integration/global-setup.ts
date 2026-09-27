import "dotenv/config";

import { assertSafeTestDatabaseEnvironment } from "../../scripts/test-database-guard";
import { createPrismaClient } from "../../src/server/db/client";

/**
 * Global setup for integration tests.
 *
 * Resets the test database before the test run starts, ensuring each run
 * begins with a clean state. This prevents data leakage between consecutive
 * test runs.
 */
export async function setup(): Promise<void> {
  const { testDatabaseUrl } = assertSafeTestDatabaseEnvironment(process.env);
  const prisma = createPrismaClient(testDatabaseUrl);

  try {
    await prisma.$transaction([
      prisma.rateLimit.deleteMany(),
      prisma.session.deleteMany(),
      prisma.account.deleteMany(),
      prisma.verification.deleteMany(),
      prisma.projectRequiredSkill.deleteMany(),
      prisma.projectInterest.deleteMany(),
      prisma.userSkill.deleteMany(),
      prisma.userInterest.deleteMany(),
      prisma.project.deleteMany(),
      prisma.profile.deleteMany(),
      prisma.user.deleteMany(),
      prisma.skill.deleteMany(),
      prisma.interest.deleteMany(),
    ]);
  } finally {
    await prisma.$disconnect();
  }
}
