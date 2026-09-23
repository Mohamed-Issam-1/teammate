import "server-only";

import { env } from "@/server/env";

import { createPrismaClient } from "./client";

type PrismaDatabaseClient = ReturnType<typeof createPrismaClient>;

/**
 * Singleton Prisma client for Next.js server code.
 *
 * `server-only` guarantees this module (and the validated environment it
 * depends on) can never be pulled into a client bundle. The instance is
 * cached on `globalThis` so development hot reloads reuse one pool instead of
 * opening a new connection pool per reload.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaDatabaseClient;
};

export const prisma: PrismaDatabaseClient =
  globalForPrisma.prisma ?? createPrismaClient(env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
