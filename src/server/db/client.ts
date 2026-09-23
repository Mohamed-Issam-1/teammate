import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Low-level Prisma client factory.
 *
 * Deliberately NOT marked `server-only`: `scripts/db-check.ts` imports this
 * module under tsx, where `server-only` throws. The Next.js server-only entry
 * point is `./index.ts` — application code must import from there, not from
 * this file.
 *
 * Requires the Prisma 7 driver adapter (`@prisma/adapter-pg`).
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
