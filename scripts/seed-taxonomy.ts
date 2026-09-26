import "dotenv/config";

import { parseEnv } from "../src/lib/env";
import { createPrismaClient } from "../src/server/db/client";
import {
  InvalidStarterTaxonomyError,
  seedStarterTaxonomy,
  TaxonomyConflictError,
} from "../src/server/taxonomy/seed-taxonomy";
import { STARTER_TAXONOMY_SOURCE } from "../src/server/taxonomy/starter-taxonomy";

/**
 * Curated starter taxonomy seed (`npm run seed:taxonomy`).
 *
 * Taxonomy is system-managed, so this command only inserts rows that are missing.
 * It is safe to run repeatedly, never updates or deletes an existing taxonomy
 * row, and never touches user assignments. If existing rows disagree with the
 * starter set, it fails closed and reports the conflict.
 *
 * It targets the database named by `DATABASE_URL`, which is the development
 * database locally and the managed database in a deployment. It never migrates,
 * resets, pushes, or drops anything. The target database *name* is printed so an
 * operator can confirm where the seed landed; the connection string never is.
 */

/**
 * Report the target by database name only.
 *
 * The name lets an operator confirm which database was seeded, and it is not a
 * credential. The connection string is never printed.
 */
function targetDatabaseName(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, "");
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    console.log(`Source: ${STARTER_TAXONOMY_SOURCE}`);
    console.log(`Target database: ${targetDatabaseName(env.DATABASE_URL)}`);

    const result = await seedStarterTaxonomy(prisma);

    console.log(
      `Skills:   inserted ${result.skillsInserted}, already present ${result.skillsSkipped}, total ${result.totalSkills}`,
    );
    console.log(
      `Interests: inserted ${result.interestsInserted}, already present ${result.interestsSkipped}, total ${result.totalInterests}`,
    );
    console.log(
      "seed:taxonomy OK - taxonomy is system-managed and was not modified.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof InvalidStarterTaxonomyError) {
    console.error("seed:taxonomy FAILED - the starter definition is invalid.");
    for (const problem of error.problems) {
      console.error(
        `  ${problem.kind} ${problem.slug ?? "(no slug)"}: ${problem.problem}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (error instanceof TaxonomyConflictError) {
    console.error(
      "seed:taxonomy FAILED - existing taxonomy conflicts with the starter set. Nothing was written.",
    );
    for (const conflict of error.conflicts) {
      console.error(
        `  ${conflict.kind} ${conflict.slug}: conflicting ${conflict.field}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  // A driver or network failure is reported as a fixed message. Printing a raw
  // third-party error would risk leaking a host, port, or credential to a
  // terminal or CI log.
  console.error(
    "seed:taxonomy FAILED - the database could not be reached or written. Check the connection configuration and migration status.",
  );
  process.exitCode = 1;
});
