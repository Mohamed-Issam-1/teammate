import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";

import type { AuthEmailOperations } from "./options";
import { createAuthOptions } from "./options";

type PrismaAdapterClient = Parameters<typeof prismaAdapter>[0];

export type AuthFactoryInput = {
  baseURL: string;
  database: PrismaAdapterClient;
  email: AuthEmailOperations;
  secret: string;
};

/** Compose the server-only Better Auth runtime from explicit dependencies. */
export function createAuth({
  baseURL,
  database,
  email,
  secret,
}: AuthFactoryInput) {
  return betterAuth({
    ...createAuthOptions({ baseURL, email }),
    secret,
    database: prismaAdapter(database, {
      provider: "postgresql",
      transaction: true,
    }),
  });
}
