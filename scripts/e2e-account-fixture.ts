import "dotenv/config";

import { assertSafeE2EDatabaseEnvironment } from "./test-database-guard";
import { createPrismaClient } from "../src/server/db/client";

/**
 * Guarded end-to-end test fixture helper.
 *
 * `/profiles/[userId]` is addressed by the user's opaque id, and the application
 * deliberately provides no way to learn it: the management pages never display or
 * link an internal id. That is the correct privacy behaviour, but it means a
 * browser test cannot discover the locator through the UI.
 *
 * So this script supplies it from the guarded test database instead. It exists
 * only for end-to-end fixtures and is deliberately not reachable from application
 * code: it lives in `scripts/`, imports nothing from `src/app`, and is never
 * spawned by the application. No HTTP endpoint is added.
 *
 * Commands:
 *   find-id <email>            print the user id for an address
 *   set-status <email> <value> set `accountStatus`, to prove that suspending a
 *                               target closes public access
 *
 * It runs out of process for the same reason as the E2E database reset: the
 * Playwright worker emits CommonJS and cannot require the ESM-only generated
 * Prisma client. The database guard runs first, so a misconfigured invocation
 * fails closed instead of touching the development database.
 */

/**
 * No environment is stubbed here on purpose.
 *
 * The runner already exports `E2E_TEST_CONTEXT` and a non-production
 * `NODE_ENV`, and this process inherits them. Self-asserting them would make the
 * guard's context checks vacuous for this entry point, so instead a manual
 * invocation outside `npm run test:e2e` fails closed with a clear message.
 */
const { testDatabaseUrl } = assertSafeE2EDatabaseEnvironment(process.env);
const prisma = createPrismaClient(testDatabaseUrl);

const ALLOWED_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

async function main(): Promise<void> {
  const [command, email, value] = process.argv.slice(2);

  if (typeof email !== "string" || !email.includes("@")) {
    throw new Error("An email address argument is required.");
  }

  if (command === "find-id") {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (user === null) {
      throw new Error("No user exists for that address.");
    }

    // The id is an opaque locator, not a credential, and this output goes to a
    // local test process rather than to a browser or a log aggregator.
    console.log(user.id);
    return;
  }

  if (command === "set-status") {
    if (typeof value !== "string" || !ALLOWED_STATUSES.has(value)) {
      throw new Error("A supported account status argument is required.");
    }

    const result = await prisma.user.updateMany({
      where: { email },
      data: { accountStatus: value },
    });

    if (result.count !== 1) {
      throw new Error("Expected exactly one matching account.");
    }

    console.log("ok");
    return;
  }

  throw new Error("Unknown command.");
}

main()
  .catch(() => {
    // Fixed message only. The error could otherwise carry a connection string.
    console.error("End-to-end account fixture failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
