import "dotenv/config";

import { parseEnv } from "../src/lib/env";
import { createPrismaClient } from "../src/server/db/client";

/**
 * Phase 0 database health check (`npm run db:check`).
 *
 * Exercises Prisma + @prisma/adapter-pg against the configured PostgreSQL
 * instance (never bare `pg`). Safe under tsx: it imports only the low-level
 * factory — never a `server-only`-marked module. DATABASE_URL is never
 * printed; error output is defensively redacted.
 */

function redact(message: string): string {
  const url = process.env.DATABASE_URL;
  return url ? message.split(url).join("[redacted]") : message;
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(
      "db:check OK - Prisma + @prisma/adapter-pg reached PostgreSQL (SELECT 1).",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("db:check FAILED -", redact(message));
  process.exitCode = 1;
});
