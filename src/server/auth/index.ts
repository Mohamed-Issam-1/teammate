import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";

import { prisma } from "@/server/db";
import { authEmail } from "@/server/email";

import { authEnv } from "./env";
import { createAuthOptions } from "./options";

/**
 * Runtime Better Auth instance.
 *
 * Runtime-only concerns—secret, Prisma adapter, and the server-only email
 * boundary—are composed here rather than in the CLI-safe options module.
 */
export const auth = betterAuth({
  ...createAuthOptions({
    baseURL: authEnv.BETTER_AUTH_URL,
    email: authEmail,
  }),
  secret: authEnv.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
});
