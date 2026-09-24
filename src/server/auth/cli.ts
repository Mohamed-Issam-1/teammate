import { betterAuth } from "better-auth";

import { parseAuthEnv } from "@/lib/env";

import { createAuthOptions } from "./options";

/**
 * CLI-only Better Auth entrypoint.
 *
 * The pinned CLI is invoked with an explicit Prisma adapter flag, so this
 * entrypoint provides the shared options without importing the runtime Prisma
 * singleton or any server-only module.
 */
const noopEmailOperation = async (): Promise<void> => {};

const authEnv = parseAuthEnv(process.env);

export const auth = betterAuth({
  ...createAuthOptions({
    baseURL: authEnv.BETTER_AUTH_URL,
    email: {
      sendVerificationEmail: noopEmailOperation,
      sendPasswordResetEmail: noopEmailOperation,
    },
  }),
  secret: authEnv.BETTER_AUTH_SECRET,
});
